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

  const full_name = String(body.full_name ?? '').trim();
  const email = String(body.email ?? '').trim();
  const phone = String(body.phone ?? '').trim();

  if (full_name.length < 3) return bad('Nombre inválido');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return bad('Correo inválido');
  if (phone.replace(/\D/g, '').length < 7) return bad('Teléfono inválido');

  const apiKey = env('ALTERESTATE_API_KEY');

  const notas = [
    body.notes ? String(body.notes).trim() : '',
    body.property_name ? `Propiedad: ${body.property_name}` : '',
    body.page_url ? `Página: ${body.page_url}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const lead: Record<string, unknown> = {
    full_name,
    email,
    phone,
    notes: notas,
    form_name: body.form_name ?? 'web',
    platform: 'Sitio web',
    ...(body.property_uid ? { property_uid: body.property_uid } : {}),
  };

  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    if (body[k]) lead[k] = String(body[k]);
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

  try {
    const res = await fetch(CRM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${apiKey}`,
      },
      body: JSON.stringify(lead),
    });

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
