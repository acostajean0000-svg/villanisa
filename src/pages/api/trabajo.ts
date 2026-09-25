/**
 * Trabajar un lead — Fase 5.
 *
 * Mover de etapa, escribir una nota y reasignar. Todo por formulario y con
 * redirección de vuelta (patrón POST-Redirect-GET): así recargar la página no
 * repite la acción y el panel sigue funcionando sin JavaScript.
 *
 * La regla de permiso está en un solo sitio, `puedeTocar()`: un asesor solo
 * trabaja lo suyo, el administrador trabaja todo. Reasignar es únicamente del
 * administrador — si cada quien pudiera pasarse los leads, la ruleta no
 * repartiría nada.
 */
import type { APIRoute } from 'astro';
import { identificar, type Quien } from '../../lib/guardia';
import {
  agregarNota,
  asignarA,
  asesorPorId,
  cambiarEtapa,
  esEtapa,
  leadPorId,
} from '../../lib/crm';

export const prerender = false;

const volver = (destino: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: destino, 'Cache-Control': 'no-store' },
  });

function destinoSeguro(v: FormDataEntryValue | null, porDefecto: string): string {
  const s = typeof v === 'string' ? v : '';
  return /^\/panel\/[a-z0-9/?=&_-]*$/i.test(s) ? s : porDefecto;
}

/** El asesor solo toca lo suyo. Se comprueba contra la base, no contra lo que llegó en el formulario. */
async function puedeTocar(quien: Quien, leadId: string): Promise<boolean> {
  if (quien.tipo === 'admin') return true;
  if (quien.tipo !== 'asesor') return false;
  const lead = await leadPorId(leadId);
  return !!lead && lead.asesor_id === quien.asesor.id;
}

export const POST: APIRoute = async ({ request }) => {
  const quien = await identificar(request);
  if (quien.tipo === 'nadie') return volver('/panel/entrar/');

  const porDefecto = quien.tipo === 'admin' ? '/panel/tablero/' : '/panel/mis-leads/';

  let datos: FormData;
  try {
    datos = await request.formData();
  } catch {
    return volver(`${porDefecto}?e=formulario`);
  }

  const id = String(datos.get('lead') ?? '');
  const destino = destinoSeguro(datos.get('ir'), porDefecto);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return volver(`${destino}?e=lead`);

  try {
    if (!(await puedeTocar(quien, id))) return volver(`${destino}?e=permiso`);

    const accion = String(datos.get('accion') ?? '');

    if (accion === 'etapa') {
      const etapa = String(datos.get('etapa') ?? '');
      if (!esEtapa(etapa)) return volver(`${destino}?e=etapa`);
      const motivo = String(datos.get('motivo') ?? '').trim().slice(0, 300) || undefined;
      await cambiarEtapa(id, etapa, quien.nombre, motivo);
      // Una nota escrita junto al cambio de etapa se guarda igual: es el caso
      // normal ("no contesta, vuelvo a llamar el martes") y perderla por estar
      // en el mismo envío sería una trampa.
      const nota = String(datos.get('nota') ?? '').trim();
      if (nota) {
        await agregarNota(id, quien.nombre, quien.tipo === 'asesor' ? quien.asesor.id : null, nota);
      }
      return volver(`${destino}?ok=etapa#lead-${id}`);
    }

    if (accion === 'nota') {
      const nota = String(datos.get('nota') ?? '').trim();
      if (!nota) return volver(`${destino}?e=nota#lead-${id}`);
      await agregarNota(id, quien.nombre, quien.tipo === 'asesor' ? quien.asesor.id : null, nota);
      return volver(`${destino}?ok=nota#lead-${id}`);
    }

    if (accion === 'asignar') {
      if (quien.tipo !== 'admin') return volver(`${destino}?e=permiso`);
      const asesorId = String(datos.get('asesor') ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(asesorId)) return volver(`${destino}?e=asesor`);
      const a = await asesorPorId(asesorId);
      if (!a) return volver(`${destino}?e=asesor`);
      await asignarA(id, { id: a.id, nombre: a.nombre });
      return volver(`${destino}?ok=asignado#lead-${id}`);
    }

    return volver(`${destino}?e=accion`);
  } catch (err) {
    console.error('[trabajo]', (err as Error).message);
    return volver(`${destino}?e=servidor`);
  }
};
