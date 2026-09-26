/**
 * Alta y baja de formularios de Meta — Fase 7.
 *
 * Solo administración: encender un formulario decide a qué equipo le entran
 * los leads de una campaña que alguien está pagando.
 */
import type { APIRoute } from 'astro';
import { identificar } from '../../../lib/guardia';
import { guardarFormulario } from '../../../lib/meta';

export const prerender = false;

const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async ({ request }) => {
  const quien = await identificar(request);
  if (quien.tipo !== 'admin') return json({ ok: false, error: 'Acceso restringido' }, 403);

  let cuerpo: { id?: string; datos?: Record<string, unknown> };
  try {
    cuerpo = await request.json();
  } catch {
    return json({ ok: false, error: 'Cuerpo inválido' }, 400);
  }

  const { id, datos = {} } = cuerpo;
  if (!id || !ES_UUID.test(id)) return json({ ok: false, error: 'Identificador inválido' }, 400);

  const cambios: { activo?: boolean; zona?: string | null; campana?: string | null } = {};
  if ('activo' in datos) cambios.activo = Boolean(datos.activo);

  if ('zona' in datos) {
    const z = String(datos.zona ?? '').trim().toLowerCase();
    // Mismo formato que las zonas de la ruleta: si no coinciden, el reparto
    // por equipo no encontraría nunca al gerente de esa zona.
    if (z && !/^[a-z0-9-]{2,60}$/.test(z)) {
      return json({ ok: false, error: 'La zona debe ser un slug como punta-cana.' }, 400);
    }
    cambios.zona = z || null;
  }

  if ('campana' in datos) {
    cambios.campana = String(datos.campana ?? '').trim().slice(0, 120) || null;
  }

  try {
    await guardarFormulario(id, cambios);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 400);
  }
};
