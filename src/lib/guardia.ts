/**
 * Quién está entrando — Fase 5.
 *
 * Dos puertas conviven a propósito:
 *
 *   - La **cookie de asesor** (nueva): cada quien ve lo suyo.
 *   - El **Basic auth del panel** (el de siempre): sigue siendo la llave
 *     maestra del administrador. Si mañana se corrompe la tabla de asesores,
 *     el dueño del negocio no se queda fuera de su propio sistema.
 *
 * Y una regla que no conviene aflojar: la cookie dice quién dijo ser, la base
 * dice quién es. Un asesor desactivado o borrado deja de entrar en su siguiente
 * clic, no cuando venza la cookie doce horas después.
 */
import { verificarBasic } from './auth';
import { COOKIE, leerCookie } from './sesion';
import { asesorPorId, type AsesorAcceso } from './crm';

export type Quien =
  | { tipo: 'admin'; nombre: string; asesor: AsesorAcceso | null }
  | { tipo: 'asesor'; nombre: string; asesor: AsesorAcceso }
  | { tipo: 'nadie' };

function galleta(cabecera: string | null, nombre: string): string | undefined {
  if (!cabecera) return undefined;
  for (const trozo of cabecera.split(';')) {
    const c = trozo.indexOf('=');
    if (c < 0) continue;
    if (trozo.slice(0, c).trim() === nombre) return trozo.slice(c + 1).trim();
  }
  return undefined;
}

export async function identificar(pedido: Request): Promise<Quien> {
  // La llave maestra primero: es la que tiene que funcionar siempre.
  if (verificarBasic(pedido.headers.get('authorization')).ok) {
    return { tipo: 'admin', nombre: 'Administración', asesor: null };
  }

  const cruda = galleta(pedido.headers.get('cookie'), COOKIE);
  const sesion = await leerCookie(cruda);
  if (!sesion) return { tipo: 'nadie' };

  let a: AsesorAcceso | null = null;
  try {
    a = await asesorPorId(sesion.id);
  } catch {
    // Si la base no responde no se puede confirmar quién es: no se entra.
    return { tipo: 'nadie' };
  }
  if (!a || !a.activo || !a.clave_hash) return { tipo: 'nadie' };

  return a.admin
    ? { tipo: 'admin', nombre: a.nombre, asesor: a }
    : { tipo: 'asesor', nombre: a.nombre, asesor: a };
}

export const esAdmin = (q: Quien): boolean => q.tipo === 'admin';

/** Respuesta estándar para quien no ha entrado: a la pantalla de acceso. */
export function aLaPuerta(destino?: string): Response {
  const a = destino ? `?ir=${encodeURIComponent(destino)}` : '';
  return new Response(null, {
    status: 302,
    headers: { Location: `/panel/entrar/${a}`, 'Cache-Control': 'no-store' },
  });
}
