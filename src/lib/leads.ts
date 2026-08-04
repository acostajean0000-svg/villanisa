/**
 * Almacén propio de leads — Fase 2.
 *
 * Hasta ahora cada contacto del sitio se escribía SOLO en AlterEstate. Eso
 * significa que el activo más valioso del negocio —el pipeline— vive en un
 * sistema de terceros: si mañana hay que migrar, no hay historial que llevarse,
 * y si su API falla un martes por la tarde, esos leads no existieron nunca.
 *
 * A partir de aquí el orden se invierte: **primero se guarda aquí, después se
 * replica al CRM**. AlterEstate deja de ser el registro y pasa a ser una copia.
 *
 * Se habla con Supabase por su API REST (PostgREST) en vez de con su SDK: son
 * tres peticiones HTTP y evita meter una dependencia de ~200 kB en una función
 * que solo tiene que insertar una fila.
 */

// Una sola lectura de variables de entorno en todo el proyecto. Estaba
// duplicada en tres archivos con la misma explicación copiada al lado.
import { env } from './auth';

export interface LeadNuevo {
  nombre: string;
  email: string;
  telefono: string;
  mensaje?: string;
  propiedad_uid?: string;
  propiedad_nombre?: string;
  asesor_ref?: string;
  asignado_a?: string;
  pagina?: string;
  formulario?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  referente?: string;
}

export interface LeadGuardado extends LeadNuevo {
  id: string;
  creado_en: string;
  crm_estado: 'pendiente' | 'enviado' | 'rechazado' | 'sin_clave';
  crm_detalle: string | null;
  crm_enviado_en: string | null;
  // Fase 3
  atendido_en: string | null;
  atendido_por: string | null;
  alertado_en: string | null;
}

const TIEMPO_LIMITE = 8_000;

function credenciales(): { url: string; clave: string } | null {
  const url = (env('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const clave = env('SUPABASE_SERVICE_KEY') ?? '';
  if (!url || !clave) return null;
  return { url, clave };
}

export const almacenConfigurado = (): boolean => credenciales() !== null;

function cabeceras(clave: string, extra: Record<string, string> = {}) {
  return {
    apikey: clave,
    Authorization: `Bearer ${clave}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/**
 * Inserta el lead y devuelve su id.
 *
 * Devuelve null —nunca lanza— si el almacén no está configurado o falla: quien
 * llama debe seguir adelante con el envío al CRM. Un fallo aquí no puede ser
 * el motivo de que un comprador se quede sin contactar.
 */
export async function guardarLead(lead: LeadNuevo): Promise<string | null> {
  const cred = credenciales();
  if (!cred) return null;

  try {
    const res = await fetch(`${cred.url}/rest/v1/leads`, {
      method: 'POST',
      headers: cabeceras(cred.clave, { Prefer: 'return=representation' }),
      body: JSON.stringify([{ ...lead, crm_estado: 'pendiente' }]),
      signal: AbortSignal.timeout(TIEMPO_LIMITE),
    });
    if (!res.ok) {
      console.error('[leads] no se pudo guardar:', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const filas = (await res.json()) as Array<{ id: string }>;
    return filas?.[0]?.id ?? null;
  } catch (err) {
    console.error('[leads] error al guardar:', (err as Error).message);
    return null;
  }
}

/**
 * Anota cómo le fue al lead en AlterEstate.
 *
 * Este campo es la razón de ser de la tabla: sin él sabríamos que el lead
 * entró, pero no si el equipo comercial llegó a verlo. Los que queden en
 * 'rechazado' son los que hay que meter a mano en el CRM.
 */
export async function marcarCRM(
  id: string,
  estado: LeadGuardado['crm_estado'],
  detalle?: string
): Promise<void> {
  const cred = credenciales();
  if (!cred) return;
  try {
    await fetch(`${cred.url}/rest/v1/leads?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: cabeceras(cred.clave, { Prefer: 'return=minimal' }),
      body: JSON.stringify({
        crm_estado: estado,
        crm_detalle: detalle ? detalle.slice(0, 500) : null,
        crm_enviado_en: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(TIEMPO_LIMITE),
    });
  } catch (err) {
    // El lead ya está guardado; que falle la anotación no justifica un error.
    console.error('[leads] no se pudo anotar el estado del CRM:', (err as Error).message);
  }
}

/**
 * Lee los últimos leads para el panel.
 *
 * Lanza en vez de devolver una lista vacía: en una pantalla de consulta,
 * "no hay leads" y "no pude leerlos" son cosas muy distintas y confundirlas
 * haría creer al equipo que el formulario dejó de funcionar.
 */
export async function listarLeads(limite = 200): Promise<LeadGuardado[]> {
  const cred = credenciales();
  if (!cred) throw new Error('El almacén de leads no está configurado.');

  const res = await fetch(
    `${cred.url}/rest/v1/leads?select=*&order=creado_en.desc&limit=${Math.min(limite, 1000)}`,
    { headers: cabeceras(cred.clave), signal: AbortSignal.timeout(TIEMPO_LIMITE) }
  );
  if (!res.ok) throw new Error(`El almacén respondió ${res.status}`);
  return (await res.json()) as LeadGuardado[];
}

/* ====================================================================== *
 * Fase 3 · Atención y alertas
 * ====================================================================== */

/**
 * Marca un lead como atendido.
 *
 * `atendido_en` no se sobrescribe si ya tiene valor: lo que interesa medir es
 * el PRIMER contacto, y permitir que un segundo clic lo reescriba borraría
 * justo el número que da sentido a toda esta fase. Por eso el filtro incluye
 * `atendido_en=is.null`.
 *
 * Devuelve cuántas filas cambió: 0 significa "ya estaba atendido", que no es
 * un error y el panel debe poder distinguirlo.
 */
export async function marcarAtendido(id: string, quien: string): Promise<number> {
  const cred = credenciales();
  if (!cred) throw new Error('El almacén de leads no está configurado.');

  const res = await fetch(
    `${cred.url}/rest/v1/leads?id=eq.${encodeURIComponent(id)}&atendido_en=is.null`,
    {
      method: 'PATCH',
      headers: cabeceras(cred.clave, { Prefer: 'return=representation' }),
      body: JSON.stringify({ atendido_en: new Date().toISOString(), atendido_por: quien.slice(0, 80) }),
      signal: AbortSignal.timeout(TIEMPO_LIMITE),
    }
  );
  if (!res.ok) throw new Error(`El almacén respondió ${res.status}`);
  return ((await res.json()) as unknown[]).length;
}

/**
 * Leads que llevan más de `minutos` sin atender y de los que no se ha avisado.
 *
 * Los dos filtros van juntos a propósito. Sin `alertado_en=is.null` el aviso se
 * repetiría en cada pasada del reloj, y un equipo al que le suena el mismo
 * contacto cada cinco minutos silencia el canal en un día.
 */
export async function leadsSinAtender(minutos: number): Promise<LeadGuardado[]> {
  const cred = credenciales();
  if (!cred) throw new Error('El almacén de leads no está configurado.');

  const limite = new Date(Date.now() - minutos * 60_000).toISOString();
  const res = await fetch(
    `${cred.url}/rest/v1/leads?select=*` +
      `&atendido_en=is.null&alertado_en=is.null&creado_en=lt.${encodeURIComponent(limite)}` +
      `&order=creado_en.asc&limit=25`,
    { headers: cabeceras(cred.clave), signal: AbortSignal.timeout(TIEMPO_LIMITE) }
  );
  if (!res.ok) throw new Error(`El almacén respondió ${res.status}`);
  return (await res.json()) as LeadGuardado[];
}

/** Anota que ya se avisó de este lead, para no repetir el aviso. */
export async function marcarAlertado(id: string): Promise<void> {
  const cred = credenciales();
  if (!cred) return;
  try {
    await fetch(`${cred.url}/rest/v1/leads?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: cabeceras(cred.clave, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ alertado_en: new Date().toISOString() }),
      signal: AbortSignal.timeout(TIEMPO_LIMITE),
    });
  } catch (err) {
    console.error('[leads] no se pudo anotar la alerta:', (err as Error).message);
  }
}

/**
 * Minutos hasta el primer contacto. null si todavía no se ha atendido.
 */
export function minutosDeRespuesta(l: LeadGuardado): number | null {
  if (!l.atendido_en) return null;
  return Math.max(
    0,
    Math.round((new Date(l.atendido_en).getTime() - new Date(l.creado_en).getTime()) / 60_000)
  );
}

/**
 * Mediana, no promedio.
 *
 * Un solo lead contestado tres días tarde arrastra el promedio y da la
 * impresión de que el equipo entero responde mal. La mediana dice cuánto tarda
 * el caso típico, que es lo que hay que mejorar.
 */
export function medianaRespuesta(leads: LeadGuardado[]): number | null {
  const v = leads.map(minutosDeRespuesta).filter((n): n is number => n !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}
