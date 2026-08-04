import type { APIRoute } from 'astro';
import { verificarBasic, RETO, env } from '../../lib/auth';
import { leadsSinAtender, marcarAlertado } from '../../lib/leads';
import { avisarLeadSinAtender, whatsappConfigurado } from '../../lib/whatsapp';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const MINUTOS_POR_DEFECTO = 10;

/**
 * Revisa qué leads llevan demasiado tiempo sin atender y avisa.
 *
 * La llama el reloj de Vercel cada cinco minutos (ver vercel.json). También se
 * puede abrir a mano desde el navegador con la clave del panel, que es como se
 * prueba sin esperar al reloj.
 *
 * Dos puertas, no una:
 *   - Vercel manda `Authorization: Bearer <CRON_SECRET>` en sus llamadas.
 *   - Un humano entra con la clave del panel.
 *
 * Si no hay ninguna de las dos configurada, la ruta se cierra. Dejarla abierta
 * permitiría a cualquiera vaciar la cola de avisos —marcando los leads como
 * "ya avisado"— y el equipo nunca sabría que dejó de recibirlos.
 */
async function ejecutar(request: Request): Promise<Response> {
  const secreto = env('CRON_SECRET');
  const cabecera = request.headers.get('authorization') ?? '';
  const esCron = Boolean(secreto) && cabecera === `Bearer ${secreto}`;
  const esPanel = verificarBasic(cabecera).ok;

  if (!esCron && !esPanel) {
    return new Response('Acceso restringido', { status: 401, headers: RETO });
  }

  const minutos = Number(env('ALERTA_MINUTOS') || MINUTOS_POR_DEFECTO);
  const espera = Number.isFinite(minutos) && minutos > 0 ? minutos : MINUTOS_POR_DEFECTO;

  let pendientes;
  try {
    pendientes = await leadsSinAtender(espera);
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 503);
  }

  if (pendientes.length === 0) {
    return json({ ok: true, revisados: 0, avisados: 0, whatsapp: whatsappConfigurado() });
  }

  let avisados = 0;
  const detalles: string[] = [];

  for (const l of pendientes) {
    const espera_min = Math.round((Date.now() - new Date(l.creado_en).getTime()) / 60_000);
    const r = await avisarLeadSinAtender({
      nombre: l.nombre,
      telefono: l.telefono,
      propiedad: l.propiedad_nombre || 'Consulta general',
      minutos: espera_min,
    });

    /**
     * Solo se marca como avisado si de verdad salió el mensaje.
     *
     * Si se marcara siempre, un token caducado convertiría esto en un agujero
     * silencioso: los leads quedarían "ya avisados" sin que nadie hubiera
     * recibido nada, y no habría forma de recuperarlos. Prefiero que se
     * reintente en la siguiente pasada.
     */
    if (r.enviados > 0) {
      await marcarAlertado(l.id);
      avisados++;
    } else {
      detalles.push(r.detalle);
    }
  }

  return json({
    ok: true,
    revisados: pendientes.length,
    avisados,
    whatsapp: whatsappConfigurado(),
    detalle: detalles.length ? detalles.slice(0, 3) : undefined,
  });
}

export const GET: APIRoute = ({ request }) => ejecutar(request);
export const POST: APIRoute = ({ request }) => ejecutar(request);
