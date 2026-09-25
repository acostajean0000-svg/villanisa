import type { APIRoute } from 'astro';
import { verificarBasic, RETO, env } from '../../lib/auth';
import { identificar } from '../../lib/guardia';
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
  // Fase 5: vale la clave maestra o cualquier sesión del equipo. Un asesor
  // marcando su propio lead como atendido es precisamente el caso de uso.
  const veredicto = verificarBasic(request.headers.get('authorization'));
  if (!veredicto.ok && veredicto.motivo === 'sin-clave') {
    return json({ ok: false, error: 'El panel no tiene clave configurada.' }, 503);
  }
  let quienSoy = env('PANEL_USUARIO') || 'panel';
  if (!veredicto.ok) {
    const quien = await identificar(request);
    if (quien.tipo === 'nadie') {
      return new Response('Acceso restringido', { status: 401, headers: RETO });
    }
    quienSoy = quien.nombre;
  }

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
    // Queda quién atendió de verdad, no un genérico "panel": con varios
    // asesores usando la misma pantalla, el nombre es media métrica.
    const cambiadas = await marcarAtendido(id, quienSoy);
    return json({ ok: true, yaEstaba: cambiadas === 0 });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 503);
  }
};
