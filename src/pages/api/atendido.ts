import type { APIRoute } from 'astro';
import { verificarBasic, RETO, env } from '../../lib/auth';
import { marcarAtendido } from '../../lib/leads';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/**
 * "Ya lo contacté" — la única entrada de datos de la Fase 3.
 *
 * Detrás de esta ruta está el dato que Villanisa nunca ha tenido: cuánto tarda
 * de verdad el equipo en responder. Por eso `marcarAtendido` no sobrescribe una
 * marca anterior, y por eso esto exige la misma clave que el panel: si
 * estuviera abierto, cualquiera podría "atender" leads desde fuera y el número
 * dejaría de significar nada.
 */
export const POST: APIRoute = async ({ request }) => {
  const veredicto = verificarBasic(request.headers.get('authorization'));
  if (!veredicto.ok && veredicto.motivo === 'sin-clave') {
    return json({ ok: false, error: 'El panel no tiene clave configurada.' }, 503);
  }
  if (!veredicto.ok) return new Response('Acceso restringido', { status: 401, headers: RETO });

  let id = '';
  try {
    id = String((await request.json()).id ?? '').trim();
  } catch {
    return json({ ok: false, error: 'Cuerpo inválido' }, 400);
  }

  // Los id son uuid. Validar la forma evita que un valor raro se cuele en la
  // consulta y, sobre todo, convierte un error confuso en uno claro.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return json({ ok: false, error: 'Identificador inválido' }, 400);
  }

  try {
    const cambiadas = await marcarAtendido(id, env('PANEL_USUARIO') || 'panel');
    return json({ ok: true, yaEstaba: cambiadas === 0 });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 503);
  }
};
