import type { APIRoute } from 'astro';

// Esta ruta corre en el servidor (función de Vercel), no en el navegador.
// Es lo que permite que la API key del CRM nunca llegue al cliente.
export const prerender = false;

const CRM_URL = 'https://secure.alterestate.com/api/v1/leads/';

/**
 * Las variables sensibles de Vercel solo existen en ejecución; `import.meta.env`
 * se resuelve en el build. Leemos las dos fuentes para que la API key del CRM
 * funcione marcada como sensible, que es como debe estar.
 */
const env = (clave: string): string | undefined => {
  const enEjecucion =
    typeof process !== 'undefined' && process.env ? process.env[clave] : undefined;
  return enEjecucion ?? (import.meta.env as Record<string, string | undefined>)[clave];
};

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

  /**
   * A quién se le asigna el lead.
   *
   * Regla de AlterEstate, textual: "If neither `related` nor `round_robin` is
   * sent, the lead is assigned to the API key owner" y "round_robin always
   * wins over related". Las dos frases juntas obligan a elegir UNA:
   *
   *   - Si la propiedad tiene asesor, va a él (`related`). Conoce la
   *     propiedad y puede responder con detalle en la primera llamada.
   *   - Si no lo tiene, o la consulta no es de una ficha concreta, entra al
   *     reparto por turnos del sitio (`round_robin`).
   *
   * Mandar los dos NO es una red de seguridad: el round robin se impondría
   * siempre y el asesor de la propiedad no recibiría nunca su lead.
   *
   * Sin ninguno de los dos configurados, todo cae en el dueño de la clave.
   * Por eso el UID del round robin es la variable que de verdad hay que
   * poner en cuanto exista la regla.
   */
  // Vienen del cliente: se acotan a la forma que emite el propio sitio para
  // que nadie pueda dirigir spam a un asesor concreto ni inventar un uid.
  const esRefValida = (v: string) => /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(v) || /^[A-Za-z0-9]{6,20}$/.test(v);
  const asesorBruto = recortar(body.agent_ref, 160);
  const asesor = esRefValida(asesorBruto) ? asesorBruto : '';
  const propiedad = /^[A-Za-z0-9]{6,20}$/.test(recortar(body.property_uid, 20))
    ? recortar(body.property_uid, 20)
    : '';
  const ruletaSitio = env('ALTERESTATE_ROUND_ROBIN_UID');

  const asignacion: Record<string, string> = asesor
    ? { related: asesor }
    : ruletaSitio
      ? { round_robin: ruletaSitio }
      : {};

  if (!asesor && !ruletaSitio) {
    console.warn('[lead] sin asesor ni round robin: se asignará al dueño de la clave');
  }

  const lead: Record<string, unknown> = {
    full_name,
    email,
    phone,
    notes: notas,
    form_name: body.form_name ?? 'web',
    // Valores que espera la API, no texto libre: 'website' y 1 = compra.
    platform: 'website',
    listing_type: 1,
    ...asignacion,
    ...(propiedad ? { property_uid: propiedad } : {}),
    ...(env('ALTERESTATE_VIA_ID') ? { via: Number(env('ALTERESTATE_VIA_ID')) } : {}),
  };

  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    if (body[k]) lead[k] = recortar(body[k], 120);
  }

  // Sin la key configurada el sitio no debe perder el lead: se registra y se
  // devuelve éxito para que el visitante no vea un error. Revisar los logs.
  if (!apiKey) {
    console.warn('[lead] ALTERESTATE_API_KEY no configurada. Lead sin enviar:', lead);
    return new Response(JSON.stringify({ ok: true, queued: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Con tiempo límite. Sin él, si AlterEstate se cuelga la función agota el
   * plazo de Vercel y el visitante ve un error genérico después de esperar.
   * Diez segundos es de sobra para un POST y deja margen para el reintento.
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
    let res = await enviar(lead);

    /**
     * Si el asesor de la propiedad no existe como usuario del CRM —se fue de
     * la empresa, o la ficha arrastra un correo viejo— la API rechaza el
     * lead entero. Perder un comprador por un dato desactualizado del CRM es
     * el peor desenlace posible, así que se reintenta sin la asignación: cae
     * en el round robin o en el dueño de la clave, pero entra.
     */
    /**
     * Solo se reintenta ante un 400: "ese asesor no existe" es un error de
     * datos y merece un segundo intento sin asignación. Un 429 o un 500 son
     * fallos del CRM, y reintentar ahí puede crear el lead DOS veces —
     * el primer envío pudo haberse procesado antes de fallar la respuesta.
     */
    if (res.status === 400 && asesor) {
      const detalle = await res.text();
      console.warn('[lead] asignación a', asesor, 'rechazada:', detalle.slice(0, 200));
      const { related, ...sinAsesor } = lead as Record<string, unknown> & { related?: string };
      res = await enviar(ruletaSitio ? { ...sinAsesor, round_robin: ruletaSitio } : sinAsesor);
    }

    if (!res.ok) {
      const text = await res.text();
      console.error('[lead] CRM respondió', res.status, text.slice(0, 300));
      return bad('No se pudo registrar el contacto', 502);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[lead] error de red', err);
    return bad('Servicio no disponible', 503);
  }
};
