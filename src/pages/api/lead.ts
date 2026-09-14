import type { APIRoute } from 'astro';
import { env } from '../../lib/auth';
import { guardarLead, marcarCRM, almacenConfigurado, type LeadNuevo } from '../../lib/leads';

// Esta ruta corre en el servidor (función de Vercel), no en el navegador.
// Es lo que permite que la API key del CRM nunca llegue al cliente.
export const prerender = false;

const CRM_URL = 'https://secure.alterestate.com/api/v1/leads/';

interface Payload {
  full_name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  property_uid?: string;
  property_name?: string;
  agent_ref?: string;
  form_name?: string;
  website?: string; // honeypot
  page_url?: string;
  [k: string]: unknown;
}

const bad = (msg: string, status = 400) =>
  new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request }) => {
  let body: Payload;
  try {
    body = await request.json();
  } catch {
    return bad('Cuerpo inválido');
  }

  // Honeypot: si viene lleno es un bot. Respondemos 200 para no darle señal.
  if (body.website) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  /**
   * Longitudes máximas. Sin ellas, cualquiera puede mandar un `notes` de
   * varios megabytes: no es un agujero de seguridad, pero llena el CRM de
   * basura y consume tiempo de función en cada envío.
   */
  const recortar = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

  const full_name = recortar(body.full_name, 120);
  const email = recortar(body.email, 160);
  const phone = recortar(body.phone, 40);

  if (full_name.length < 3) return bad('Nombre inválido');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return bad('Correo inválido');
  if (phone.replace(/\D/g, '').length < 7) return bad('Teléfono inválido');

  const apiKey = env('ALTERESTATE_API_KEY');

  const notas = [
    recortar(body.notes, 2000),
    body.property_name ? `Propiedad: ${body.property_name}` : '',
    body.page_url ? `Página: ${body.page_url}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  // Nota: el asesor de la ficha se añade más abajo, después de validarlo.

  /**
   * A quién se le asigna el lead: SIEMPRE al round robin.
   *
   * Regla de AlterEstate, textual: "If neither `related` nor `round_robin` is
   * sent, the lead is assigned to the API key owner" y "round_robin always
   * wins over related".
   *
   * Antes esta función mandaba `related` cuando la ficha traía asesor, y solo
   * caía al reparto por turnos si no lo tenía. Eso repartía los leads según
   * quién hubiera cargado la propiedad en el CRM — que no es lo mismo que
   * quién está disponible para atender. Ahora entra todo por la ruleta, que
   * es la que Villanisa controla desde AlterEstate sin tocar código.
   *
   * El asesor de la ficha no se pierde: va en las notas del lead, para que
   * quien lo reciba sepa a quién preguntarle por esa propiedad.
   *
   * Para volver al reparto por ficha, esto es una línea: devolver
   * `asesor ? { related: asesor } : ...`.
   */
  // Vienen del cliente: se acotan a la forma que emite el propio sitio para
  // que nadie pueda dirigir spam a un asesor concreto ni inventar un uid.
  const esRefValida = (v: string) =>
    /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(v) || /^[A-Za-z0-9]{6,20}$/.test(v);
  const asesorBruto = recortar(body.agent_ref, 160);
  const asesor = esRefValida(asesorBruto) ? asesorBruto : '';
  const propiedad = /^[A-Za-z0-9]{6,20}$/.test(recortar(body.property_uid, 20))
    ? recortar(body.property_uid, 20)
    : '';
  const ruletaSitio = env('ALTERESTATE_ROUND_ROBIN_UID');

  const asignacion: Record<string, string> = ruletaSitio
    ? { round_robin: ruletaSitio }
    : {};

  if (!ruletaSitio) {
    console.warn('[lead] sin ALTERESTATE_ROUND_ROBIN_UID: el lead caerá en el dueño de la clave');
  }

  const utm: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    if (body[k]) utm[k] = recortar(body[k], 120);
  }

  /* ------------------------------------------------------------------ *
   * 1. Primero, el registro propio.
   *
   * Este es el cambio de fondo de la Fase 2. Antes esta función empezaba
   * hablándole a AlterEstate; ahora AlterEstate es el segundo paso. Si su
   * API está caída, el lead ya está a salvo y el panel lo marca para
   * meterlo a mano. Antes, simplemente se perdía.
   * ------------------------------------------------------------------ */
  const propio: LeadNuevo = {
    nombre: full_name,
    email,
    telefono: phone,
    mensaje: recortar(body.notes, 2000) || undefined,
    propiedad_uid: propiedad || undefined,
    propiedad_nombre: recortar(body.property_name, 200) || undefined,
    asesor_ref: asesor || undefined,
    asignado_a: ruletaSitio ? 'round_robin' : 'dueño de la clave',
    pagina: recortar(body.page_url, 500) || undefined,
    formulario: recortar(body.form_name, 60) || 'web',
    referente: recortar(body.referrer ?? request.headers.get('referer'), 500) || undefined,
    ...utm,
  };

  const idPropio = await guardarLead(propio);
  if (!idPropio && almacenConfigurado()) {
    // Configurado pero fallando: hay que enterarse, no seguir en silencio.
    console.error('[lead] el almacén propio está configurado pero rechazó el lead');
  }

  /* ------------------------------------------------------------------ *
   * 2. Después, la réplica al CRM.
   * ------------------------------------------------------------------ */
  /**
   * El asesor de la ficha ya no dirige el lead, pero sigue siendo el dato
   * más útil para quien lo atienda: es quien conoce esa propiedad. Va al
   * final de las notas para que aparezca en el CRM.
   */
  const notasCRM = [notas, asesor ? `Asesor de la ficha: ${asesor}` : '']
    .filter(Boolean)
    .join('\n');

  const lead: Record<string, unknown> = {
    full_name,
    email,
    phone,
    notes: notasCRM,
    form_name: body.form_name ?? 'web',
    // Valores que espera la API, no texto libre: 'website' y 1 = compra.
    platform: 'website',
    listing_type: 1,
    ...asignacion,
    ...(propiedad ? { property_uid: propiedad } : {}),
    ...(env('ALTERESTATE_VIA_ID') ? { via: Number(env('ALTERESTATE_VIA_ID')) } : {}),
    ...utm,
  };

  /**
   * Cierra la petición diciendo la verdad de lo que pasó.
   *
   * `ok` es true si el lead quedó registrado EN ALGÚN SITIO. Que AlterEstate
   * lo haya rechazado es un problema del equipo, no del visitante: si ya
   * tenemos su contacto guardado, mostrarle un error solo consigue que se
   * vaya a otra inmobiliaria mientras nosotros sí tenemos su teléfono.
   */
  const responder = (guardado: boolean, enCRM: boolean) =>
    guardado || enCRM
      ? new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      : bad('No se pudo registrar el contacto', 502);

  if (!apiKey) {
    console.warn('[lead] ALTERESTATE_API_KEY no configurada. Lead sin replicar al CRM.');
    if (idPropio) await marcarCRM(idPropio, 'sin_clave', 'ALTERESTATE_API_KEY no configurada');
    return responder(Boolean(idPropio), false);
  }

  /**
   * Con tiempo límite. Sin él, si AlterEstate se cuelga la función agota el
   * plazo de Vercel y el visitante ve un error genérico después de esperar.
   */
  const enviar = (payload: Record<string, unknown>) =>
    fetch(CRM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

  try {
    const res = await enviar(lead);

    /**
     * Aquí vivía un reintento sin `related` para cuando el asesor de la ficha
     * ya no existía en el CRM y la API rechazaba el lead entero. Al mandar
     * siempre `round_robin`, ese fallo dejó de ser posible: la regla de
     * reparto la administra Villanisa y no depende de un correo viejo
     * arrastrado en una propiedad.
     *
     * No se reintenta ante 429 ni 500: son fallos del CRM, y reintentar ahí
     * puede crear el lead DOS veces — el primer envío pudo procesarse antes
     * de que fallara la respuesta.
     */

    if (!res.ok) {
      const text = await res.text();
      console.error('[lead] CRM respondió', res.status, text.slice(0, 300));
      if (idPropio) await marcarCRM(idPropio, 'rechazado', `HTTP ${res.status}: ${text}`);
      return responder(Boolean(idPropio), false);
    }

    if (idPropio) await marcarCRM(idPropio, 'enviado');
    return responder(Boolean(idPropio), true);
  } catch (err) {
    console.error('[lead] error de red', err);
    if (idPropio) await marcarCRM(idPropio, 'rechazado', `Red: ${(err as Error).message}`);
    return responder(Boolean(idPropio), false);
  }
};
