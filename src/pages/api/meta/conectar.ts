/**
 * Conectar una página de Facebook — Fase 7.
 *
 * Dos rutas en un archivo porque son las dos mitades del mismo viaje: se sale
 * hacia Facebook y se vuelve de Facebook.
 *
 * El `state` no es decorativo: es lo que impide que alguien induzca al
 * administrador a conectar, sin querer, una página que no es suya. Se firma
 * con el mismo secreto de sesión y se comprueba a la vuelta.
 */
import type { APIRoute } from 'astro';
import { identificar } from '../../../lib/guardia';
import { crearCookie, leerCookie } from '../../../lib/sesion';
import { urlDeConexion, metaConfigurado } from '../../../lib/meta';

export const prerender = false;

const ESTADO = 'vs_meta_estado';

const irA = (destino: string, cookie?: string) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: destino,
      'Cache-Control': 'no-store',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });

export const GET: APIRoute = async ({ request, url }) => {
  const quien = await identificar(request);
  if (quien.tipo !== 'admin') return irA('/panel/entrar/?ir=/panel/meta/');

  if (!metaConfigurado()) return irA('/panel/meta/?e=configuracion');

  // Se reutiliza la cookie firmada de sesión como portador del `state`: mismo
  // secreto, misma comprobación, y nada nuevo que mantener.
  const testigo = await crearCookie({ id: 'meta-oauth', nombre: quien.nombre, admin: true });
  if (!testigo) return irA('/panel/meta/?e=configuracion');

  const destino = urlDeConexion(url.origin, testigo);
  if (!destino) return irA('/panel/meta/?e=configuracion');

  const seguro = (process.env.NODE_ENV ?? 'production') !== 'development' ? ' Secure;' : '';
  return irA(destino, `${ESTADO}=${testigo}; Path=/; HttpOnly;${seguro} SameSite=Lax; Max-Age=600`);
};

/** Comprueba el `state` de la vuelta. Exportado para que lo use el callback. */
export async function estadoValido(
  recibido: string | null,
  cabeceraCookie: string | null
): Promise<boolean> {
  if (!recibido) return false;
  // Tiene que ser una firma nuestra y viva...
  if (!(await leerCookie(recibido))) return false;
  // ...y además la misma que se entregó al salir.
  for (const trozo of (cabeceraCookie ?? '').split(';')) {
    const c = trozo.indexOf('=');
    if (c > 0 && trozo.slice(0, c).trim() === ESTADO) {
      return trozo.slice(c + 1).trim() === recibido;
    }
  }
  return false;
}

export const COOKIE_ESTADO = ESTADO;
