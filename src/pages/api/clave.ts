/**
 * El asesor pone su propia clave — Fase 5b.
 *
 * Dos caminos al mismo sitio:
 *
 *   - Con un token de invitación, para estrenar acceso.
 *   - Con la sesión abierta y la clave actual, para cambiarla.
 *
 * Nunca se confía en un `id` que venga del formulario: el token dice de quién
 * es la invitación y la cookie dice quién está dentro. Si el id lo pusiera el
 * navegador, cualquier asesor podría cambiarle la clave a otro.
 */
import type { APIRoute } from 'astro';
import { identificar } from '../../lib/guardia';
import { asesorDeInvitacion, usarInvitacion } from '../../lib/invitacion';
import { claveCorrecta, hashearClave } from '../../lib/sesion';
import { guardarClave } from '../../lib/crm';

export const prerender = false;

const MINIMO = 8;

const volver = (destino: string) =>
  new Response(null, { status: 302, headers: { Location: destino, 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  let datos: FormData;
  try {
    datos = await request.formData();
  } catch {
    return volver('/panel/clave/?e=formulario');
  }

  const token = String(datos.get('t') ?? '').trim();
  const clave = String(datos.get('clave') ?? '');
  const repetida = String(datos.get('repetida') ?? '');
  const cola = token ? `&t=${encodeURIComponent(token)}` : '';

  if (clave.length < MINIMO) return volver(`/panel/clave/?e=corta${cola}`);
  if (clave.length > 200) return volver(`/panel/clave/?e=larga${cola}`);
  if (clave !== repetida) return volver(`/panel/clave/?e=distintas${cola}`);

  try {
    /* ---- Camino 1: invitación ---- */
    if (token) {
      const asesor = await asesorDeInvitacion(token);
      if (!asesor) return volver('/panel/clave/?e=invitacion');
      const usada = await usarInvitacion(token, await hashearClave(clave));
      if (!usada) return volver('/panel/clave/?e=invitacion');
      // No se le abre sesión automáticamente: que entre por la puerta una vez
      // confirma que la clave que acaba de escribir es la que recuerda.
      return volver('/panel/entrar/?nueva=1');
    }

    /* ---- Camino 2: cambio con la sesión abierta ---- */
    const quien = await identificar(request);
    if (quien.tipo === 'nadie' || !quien.asesor) return volver('/panel/entrar/');

    const actual = String(datos.get('actual') ?? '');
    if (!(await claveCorrecta(actual, quien.asesor.clave_hash))) {
      return volver('/panel/clave/?e=actual');
    }
    await guardarClave(quien.asesor.id, await hashearClave(clave));
    return volver('/panel/clave/?ok=1');
  } catch (err) {
    console.error('[clave]', (err as Error).message);
    return volver(`/panel/clave/?e=servidor${cola}`);
  }
};
