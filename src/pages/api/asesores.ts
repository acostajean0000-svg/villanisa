import type { APIRoute } from 'astro';
import { verificarBasic, RETO } from '../../lib/auth';
import { guardarAsesor, crearAsesor, borrarAsesor, type CambioAsesor } from '../../lib/ruleta';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Administra la ruleta desde el panel.
 *
 * Exige la misma clave que el resto del panel. Si estuviera abierto,
 * cualquiera podría desviarse todos los leads del sitio a su propio correo
 * con una sola petición — es la ruta más sensible del proyecto.
 */
function limpiar(bruto: Record<string, unknown>): CambioAsesor {
  const c: CambioAsesor = {};
  const txt = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

  if ('nombre' in bruto) c.nombre = txt(bruto.nombre, 80);
  if ('telefono' in bruto) c.telefono = txt(bruto.telefono, 40) || null as unknown as string;
  if ('activo' in bruto) c.activo = Boolean(bruto.activo);
  if ('orden' in bruto) {
    const n = Number(bruto.orden);
    c.orden = Number.isFinite(n) ? Math.max(0, Math.min(9999, Math.round(n))) : 100;
  }

  /**
   * La referencia de AlterEstate se acota a correo o UID. Es lo que viaja
   * como `related` al CRM: un valor con forma rara no llegaría a ninguna
   * parte, y da igual descubrirlo aquí que después de perder un lead.
   */
  if ('ae_ref' in bruto) {
    const v = txt(bruto.ae_ref, 160);
    const ok = !v || /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(v) || /^[A-Za-z0-9]{6,20}$/.test(v);
    if (!ok) throw new Error('La referencia de AlterEstate debe ser un correo o un UID.');
    c.ae_ref = v || null as unknown as string;
  }

  if ('zonas' in bruto) {
    const lista = Array.isArray(bruto.zonas) ? bruto.zonas : String(bruto.zonas ?? '').split(',');
    c.zonas = lista
      .map((z) => String(z).trim().toLowerCase())
      .filter((z) => /^[a-z0-9-]{2,60}$/.test(z))
      .slice(0, 20);
  }

  for (const k of ['hora_desde', 'hora_hasta'] as const) {
    if (k in bruto) {
      const v = bruto[k];
      if (v === null || v === '' || v === undefined) c[k] = null;
      else {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 23) throw new Error('La hora debe ir de 0 a 23.');
        c[k] = Math.round(n);
      }
    }
  }

  if ('pausado_hasta' in bruto) {
    const v = txt(bruto.pausado_hasta, 40);
    if (!v) c.pausado_hasta = null;
    else {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new Error('Fecha de pausa inválida.');
      c.pausado_hasta = d.toISOString();
    }
  }

  // Un turno abierto por un lado y cerrado por el otro no define nada.
  if ((c.hora_desde === null) !== (c.hora_hasta === null) && 'hora_desde' in c && 'hora_hasta' in c) {
    throw new Error('El horario necesita las dos horas, o ninguna.');
  }

  return c;
}

export const POST: APIRoute = async ({ request }) => {
  const veredicto = verificarBasic(request.headers.get('authorization'));
  if (!veredicto.ok && veredicto.motivo === 'sin-clave') {
    return json({ ok: false, error: 'El panel no tiene clave configurada.' }, 503);
  }
  if (!veredicto.ok) return new Response('Acceso restringido', { status: 401, headers: RETO });

  let cuerpo: { accion?: string; id?: string; datos?: Record<string, unknown> };
  try {
    cuerpo = await request.json();
  } catch {
    return json({ ok: false, error: 'Cuerpo inválido' }, 400);
  }

  const { accion, id, datos = {} } = cuerpo;

  try {
    if (accion === 'crear') {
      const c = limpiar(datos);
      if (!c.nombre) return json({ ok: false, error: 'El nombre es obligatorio.' }, 400);
      await crearAsesor({ ...c, nombre: c.nombre });
      return json({ ok: true });
    }

    if (!id || !ES_UUID.test(id)) return json({ ok: false, error: 'Identificador inválido' }, 400);

    if (accion === 'guardar') {
      await guardarAsesor(id, limpiar(datos));
      return json({ ok: true });
    }

    if (accion === 'borrar') {
      await borrarAsesor(id);
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Acción desconocida' }, 400);
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 400);
  }
};
