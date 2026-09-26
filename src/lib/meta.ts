/**
 * Meta Lead Ads — Fase 7.
 *
 * Recibe los leads de las campañas de Facebook en el sistema propio, en vez de
 * que entren directo a AlterEstate y nadie pueda medirlos.
 *
 * El flujo real es este: Meta avisa por webhook con un `leadgen_id` —el aviso
 * NO trae los datos del contacto—, y hay que ir a buscarlos a la Graph API con
 * el token de la página. Por eso hace falta guardar ese token.
 */
import { env } from './auth';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TIEMPO_LIMITE = 8_000;

/* ------------------------------------------------------------------ *
 * Almacén
 * ------------------------------------------------------------------ */

export interface PaginaMeta {
  id: string;
  page_id: string;
  nombre: string;
  token: string;
  conectada_por: string | null;
  conectada_en: string;
  fallo_en: string | null;
  fallo_detalle: string | null;
}

export interface FormularioMeta {
  id: string;
  form_id: string;
  nombre: string;
  pagina_id: string | null;
  activo: boolean;
  zona: string | null;
  campana: string | null;
  recibidos: number;
  ultimo_en: string | null;
  creado_en: string;
}

function credenciales(): { url: string; clave: string } {
  const url = (env('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const clave = env('SUPABASE_SERVICE_KEY') ?? '';
  if (!url || !clave) throw new Error('El almacén no está configurado.');
  return { url, clave };
}

const cabeceras = (clave: string, extra: Record<string, string> = {}) => ({
  apikey: clave,
  Authorization: `Bearer ${clave}`,
  'Content-Type': 'application/json',
  ...extra,
});

async function pedir(ruta: string, init: RequestInit = {}): Promise<Response> {
  const c = credenciales();
  const res = await fetch(`${c.url}/rest/v1/${ruta}`, {
    ...init,
    headers: cabeceras(c.clave, (init.headers as Record<string, string>) ?? {}),
    signal: AbortSignal.timeout(TIEMPO_LIMITE),
  });
  if (!res.ok) throw new Error(`El almacén respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

export async function listarPaginas(): Promise<PaginaMeta[]> {
  return (await (await pedir('meta_paginas?select=*&order=nombre.asc')).json()) as PaginaMeta[];
}

export async function paginaPorPageId(pageId: string): Promise<PaginaMeta | null> {
  const r = (await (
    await pedir(`meta_paginas?select=*&page_id=eq.${encodeURIComponent(pageId)}&limit=1`)
  ).json()) as PaginaMeta[];
  return r[0] ?? null;
}

/** Alta o actualización de una página. Reconectar renueva el token y limpia el fallo. */
export async function guardarPagina(p: {
  page_id: string;
  nombre: string;
  token: string;
  conectada_por?: string | null;
}): Promise<void> {
  await pedir('meta_paginas?on_conflict=page_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([
      {
        ...p,
        conectada_en: new Date().toISOString(),
        fallo_en: null,
        fallo_detalle: null,
      },
    ]),
  });
}

/**
 * Marca que el token de una página dejó de servir.
 *
 * Es el aviso que hoy no existe: cuando la persona que conectó Facebook cambia
 * su clave o revoca permisos, los leads dejan de entrar en silencio. Aquí al
 * menos queda escrito y el panel lo puede enseñar en rojo.
 */
export async function marcarFalloPagina(pageId: string, detalle: string): Promise<void> {
  try {
    await pedir(`meta_paginas?page_id=eq.${encodeURIComponent(pageId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ fallo_en: new Date().toISOString(), fallo_detalle: detalle.slice(0, 300) }),
    });
  } catch {
    /* informativo */
  }
}

export async function listarFormularios(): Promise<FormularioMeta[]> {
  return (await (
    await pedir('meta_formularios?select=*&order=activo.desc,nombre.asc')
  ).json()) as FormularioMeta[];
}

export async function formularioActivo(formId: string): Promise<FormularioMeta | null> {
  const r = (await (
    await pedir(`meta_formularios?select=*&form_id=eq.${encodeURIComponent(formId)}&activo=is.true&limit=1`)
  ).json()) as FormularioMeta[];
  return r[0] ?? null;
}

/** Guarda los formularios que Meta devuelve, sin pisar lo ya configurado. */
export async function sincronizarFormularios(
  paginaId: string,
  formularios: Array<{ form_id: string; nombre: string }>
): Promise<number> {
  if (!formularios.length) return 0;
  const existentes = new Set((await listarFormularios()).map((f) => f.form_id));
  const nuevos = formularios.filter((f) => !existentes.has(f.form_id));
  if (!nuevos.length) return 0;
  await pedir('meta_formularios', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    // Inactivos: recibir los 166 de golpe sería justo lo que no queremos.
    body: JSON.stringify(nuevos.map((f) => ({ ...f, pagina_id: paginaId, activo: false }))),
  });
  return nuevos.length;
}

export async function guardarFormulario(
  id: string,
  cambios: { activo?: boolean; zona?: string | null; campana?: string | null }
): Promise<void> {
  await pedir(`meta_formularios?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(cambios),
  });
}

export async function contarRecibido(formId: string, actual: number): Promise<void> {
  try {
    await pedir(`meta_formularios?form_id=eq.${encodeURIComponent(formId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ recibidos: actual + 1, ultimo_en: new Date().toISOString() }),
    });
  } catch {
    /* el contador es informativo */
  }
}

/* ------------------------------------------------------------------ *
 * Firma del webhook
 * ------------------------------------------------------------------ */

/**
 * Comprueba que la petición viene de Meta.
 *
 * Sin esto, cualquiera que conozca la URL puede inventarse leads en la base
 * del negocio. Meta firma el cuerpo con el secreto de la app en la cabecera
 * `X-Hub-Signature-256`, y hay que verificar sobre el cuerpo **crudo**: si se
 * reserializa el JSON, el hash cambia y nada valida nunca.
 */
export async function firmaValida(cuerpoCrudo: string, cabecera: string | null): Promise<boolean> {
  const secreto = env('META_APP_SECRET');
  if (!secreto || !cabecera?.startsWith('sha256=')) return false;

  const llave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma = new Uint8Array(
    await crypto.subtle.sign('HMAC', llave, new TextEncoder().encode(cuerpoCrudo))
  );
  const esperado = [...firma].map((b) => b.toString(16).padStart(2, '0')).join('');
  const recibido = cabecera.slice(7).toLowerCase();

  // Tiempo constante.
  if (esperado.length !== recibido.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  return dif === 0;
}

/* ------------------------------------------------------------------ *
 * Graph API
 * ------------------------------------------------------------------ */

export interface LeadMeta {
  leadgen_id: string;
  form_id: string;
  ad_id: string | null;
  nombre: string;
  email: string;
  telefono: string;
  mensaje: string;
  creado_en: string | null;
}

/** Campos estándar de Meta; lo demás se considera pregunta del formulario. */
const CAMPO = new Map<string, 'nombre' | 'email' | 'telefono' | 'nombre1' | 'nombre2'>([
  ['full_name', 'nombre'],
  ['nombre_completo', 'nombre'],
  ['email', 'email'],
  ['correo_electrónico', 'email'],
  ['phone_number', 'telefono'],
  ['número_de_teléfono', 'telefono'],
  ['first_name', 'nombre1'],
  ['last_name', 'nombre2'],
]);

/**
 * Trae los datos del contacto a partir del aviso.
 *
 * El webhook solo manda un identificador; los datos hay que pedirlos. Devuelve
 * null si Meta rechaza el token, para que quien llama lo marque y avise en vez
 * de perder el lead en un log.
 */
export async function traerLead(
  leadgenId: string,
  token: string
): Promise<{ lead: LeadMeta | null; error: string | null }> {
  try {
    const url =
      `${GRAPH}/${encodeURIComponent(leadgenId)}` +
      `?fields=id,created_time,ad_id,form_id,field_data&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_LIMITE) });
    const dato = (await res.json()) as {
      id?: string;
      created_time?: string;
      ad_id?: string;
      form_id?: string;
      field_data?: Array<{ name?: string; values?: string[] }>;
      error?: { message?: string; code?: number };
    };

    if (!res.ok || dato.error) {
      return { lead: null, error: dato.error?.message ?? `HTTP ${res.status}` };
    }

    let nombre = '', nombre1 = '', nombre2 = '', email = '', telefono = '';
    const otros: string[] = [];

    for (const c of dato.field_data ?? []) {
      const clave = (c.name ?? '').toLowerCase();
      const valor = (c.values ?? []).join(', ').trim();
      if (!valor) continue;
      switch (CAMPO.get(clave)) {
        case 'nombre': nombre = valor; break;
        case 'nombre1': nombre1 = valor; break;
        case 'nombre2': nombre2 = valor; break;
        case 'email': email = valor; break;
        case 'telefono': telefono = valor; break;
        // Las preguntas propias del formulario son lo más valioso del lead
        // ("¿cuándo piensa mudarse?"), así que van al mensaje en vez de tirarse.
        default: otros.push(`${c.name}: ${valor}`);
      }
    }

    return {
      lead: {
        leadgen_id: dato.id ?? leadgenId,
        form_id: dato.form_id ?? '',
        ad_id: dato.ad_id ?? null,
        nombre: nombre || [nombre1, nombre2].filter(Boolean).join(' '),
        email,
        telefono,
        mensaje: otros.join('\n'),
        creado_en: dato.created_time ?? null,
      },
      error: null,
    };
  } catch (err) {
    return { lead: null, error: (err as Error).message };
  }
}

/* ------------------------------------------------------------------ *
 * Conexión de la página (OAuth)
 * ------------------------------------------------------------------ */

export function urlDeConexion(origen: string, estado: string): string | null {
  const appId = env('META_APP_ID');
  if (!appId) return null;
  const permisos = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_metadata',
    'leads_retrieval',
  ].join(',');
  return (
    `https://www.facebook.com/v21.0/dialog/oauth?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(`${origen}/api/meta/callback`)}` +
    `&state=${encodeURIComponent(estado)}&scope=${encodeURIComponent(permisos)}&response_type=code`
  );
}

/** Cambia el código de la vuelta por un token de usuario. */
export async function tokenDeUsuario(codigo: string, origen: string): Promise<string | null> {
  const appId = env('META_APP_ID');
  const secreto = env('META_APP_SECRET');
  if (!appId || !secreto) return null;
  try {
    const url =
      `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(secreto)}` +
      `&redirect_uri=${encodeURIComponent(`${origen}/api/meta/callback`)}` +
      `&code=${encodeURIComponent(codigo)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_LIMITE) });
    const d = (await res.json()) as { access_token?: string };
    return d.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Páginas que administra quien acaba de conectar, con su token.
 *
 * El token de página que devuelve `/me/accounts` derivado de un token de
 * usuario de larga duración no caduca por tiempo, solo si la persona cambia su
 * clave o revoca el permiso. Es lo más estable que ofrece Meta, y aun así por
 * eso existe `marcarFalloPagina`.
 */
export async function paginasDelUsuario(
  tokenUsuario: string
): Promise<Array<{ page_id: string; nombre: string; token: string }>> {
  const appId = env('META_APP_ID');
  const secreto = env('META_APP_SECRET');
  let token = tokenUsuario;

  // Primero se alarga el token de usuario; si no, los de página heredan su
  // caducidad de una hora y la conexión se cae sola esta misma tarde.
  if (appId && secreto) {
    try {
      const url =
        `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
        `&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(secreto)}` +
        `&fb_exchange_token=${encodeURIComponent(tokenUsuario)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_LIMITE) });
      const d = (await res.json()) as { access_token?: string };
      if (d.access_token) token = d.access_token;
    } catch {
      /* se sigue con el corto: mejor una conexión de una hora que ninguna */
    }
  }

  const res = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(TIEMPO_LIMITE) }
  );
  const d = (await res.json()) as {
    data?: Array<{ id?: string; name?: string; access_token?: string }>;
  };
  return (d.data ?? [])
    .filter((p) => p.id && p.access_token)
    .map((p) => ({ page_id: p.id!, nombre: p.name ?? p.id!, token: p.access_token! }));
}

/** Formularios de una página. */
export async function formulariosDePagina(
  pageId: string,
  token: string
): Promise<Array<{ form_id: string; nombre: string }>> {
  const res = await fetch(
    `${GRAPH}/${encodeURIComponent(pageId)}/leadgen_forms?fields=id,name,status&limit=200` +
      `&access_token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(TIEMPO_LIMITE) }
  );
  const d = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
  return (d.data ?? []).filter((f) => f.id).map((f) => ({ form_id: f.id!, nombre: f.name ?? f.id! }));
}

/** Suscribe la página al webhook de leads. Sin esto Meta no avisa nada. */
export async function suscribirPagina(pageId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=leadgen` +
        `&access_token=${encodeURIComponent(token)}`,
      { method: 'POST', signal: AbortSignal.timeout(TIEMPO_LIMITE) }
    );
    const d = (await res.json()) as { success?: boolean; error?: { message?: string } };
    if (d.error) return d.error.message ?? 'error desconocido';
    return d.success ? null : 'Meta no confirmó la suscripción';
  } catch (err) {
    return (err as Error).message;
  }
}

export const metaConfigurado = (): boolean =>
  Boolean(env('META_APP_ID') && env('META_APP_SECRET') && env('META_VERIFY_TOKEN'));
