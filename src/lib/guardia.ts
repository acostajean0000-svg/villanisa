/**
 * Quién está entrando — Fases 5 y 6.
 *
 * Tres puertas conviven a propósito:
 *
 *   - La **cookie de asesor**: cada quien ve lo suyo.
 *   - La **cookie de gerente**: ve lo de su equipo.
 *   - El **Basic auth del panel**: la llave maestra del administrador. Si
 *     mañana se corrompe la tabla de asesores, el dueño del negocio no se
 *     queda fuera de su propio sistema.
 *
 * Y una regla que no conviene aflojar: la cookie dice quién dijo ser, la base
 * dice quién es. Un asesor desactivado, degradado o borrado deja de entrar en
 * su siguiente clic, no cuando venza la cookie doce horas después.
 */
import { verificarBasic } from './auth';
import { COOKIE, leerCookie } from './sesion';
import { asesorPorId, type AsesorAcceso, type Rol } from './crm';

export type Quien =
  | { tipo: 'admin'; nombre: string; asesor: AsesorAcceso | null }
  | { tipo: 'gerente'; nombre: string; asesor: AsesorAcceso }
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

/**
 * El rol efectivo de una fila.
 *
 * `rol` es lo de la Fase 6; `admin` es la marca booleana de la Fase 5 que
 * puede seguir puesta en filas antiguas. Se respetan las dos, y la más
 * permisiva gana: degradar a alguien sin querer por una migración sería peor
 * que mantener un administrador de más que el propio dueño puso.
 */
function rolDe(a: AsesorAcceso): Rol {
  if (a.admin === true) return 'admin';
  const r = a.rol;
  return r === 'admin' || r === 'gerente' ? r : 'asesor';
}

export async function identificar(pedido: Request): Promise<Quien> {
  // La llave maestra primero: es la que tiene que funcionar siempre.
  if (verificarBasic(pedido.headers.get('authorization')).ok) {
    return { tipo: 'admin', nombre: 'Administración', asesor: null };
  }

  const sesion = await leerCookie(galleta(pedido.headers.get('cookie'), COOKIE));
  if (!sesion) return { tipo: 'nadie' };

  let a: AsesorAcceso | null = null;
  try {
    a = await asesorPorId(sesion.id);
  } catch {
    // Si la base no responde no se puede confirmar quién es: no se entra.
    return { tipo: 'nadie' };
  }
  if (!a || !a.activo || !a.clave_hash) return { tipo: 'nadie' };

  const rol = rolDe(a);
  if (rol === 'admin') return { tipo: 'admin', nombre: a.nombre, asesor: a };
  if (rol === 'gerente') return { tipo: 'gerente', nombre: a.nombre, asesor: a };
  return { tipo: 'asesor', nombre: a.nombre, asesor: a };
}

export const esAdmin = (q: Quien): boolean => q.tipo === 'admin';
/** Ve más de un buzón: administración o un gerente. */
export const supervisa = (q: Quien): boolean => q.tipo === 'admin' || q.tipo === 'gerente';

/** Respuesta estándar para quien no ha entrado: a la pantalla de acceso. */
export function aLaPuerta(destino?: string): Response {
  const a = destino ? `?ir=${encodeURIComponent(destino)}` : '';
  return new Response(null, {
    status: 302,
    headers: { Location: `/panel/entrar/${a}`, 'Cache-Control': 'no-store' },
  });
}
