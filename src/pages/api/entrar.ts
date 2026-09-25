/**
 * Entrada y salida del asesor — Fase 5.
 *
 * Recibe el formulario de /panel/entrar, comprueba la clave y deja la cookie
 * firmada. Devuelve siempre el mismo mensaje cuando falla —"Correo o clave
 * incorrectos"— aunque sepa perfectamente cuál de las dos cosas falló:
 * distinguirlas convierte la pantalla en un buscador de correos dados de alta.
 */
import type { APIRoute } from 'astro';
import { asesorPorCorreo, anotarAcceso } from '../../lib/crm';
import { claveCorrecta, crearCookie, atributosCookie, cookieVacia } from '../../lib/sesion';

export const prerender = false;

/**
 * Freno a la fuerza bruta.
 *
 * Es memoria del proceso, no de la base: en Vercel cada instancia cuenta por
 * su lado, así que no es una defensa perfecta. Pero PBKDF2 con 210.000
 * iteraciones ya hace que probar claves cueste caro, y esto corta el caso
 * común —un script insistiendo sobre un correo— sin añadir una tabla ni una
 * consulta más en el camino de la entrada.
 */
const intentos = new Map<string, { n: number; hasta: number }>();
const TOPE = 8;
const CASTIGO = 10 * 60_000;

function frenado(llave: string): boolean {
  const e = intentos.get(llave);
  if (!e) return false;
  if (Date.now() > e.hasta) {
    intentos.delete(llave);
    return false;
  }
  return e.n >= TOPE;
}

function fallo(llave: string): void {
  const e = intentos.get(llave);
  const n = e && Date.now() <= e.hasta ? e.n + 1 : 1;
  intentos.set(llave, { n, hasta: Date.now() + CASTIGO });
  // La tabla no puede crecer sin techo si alguien rota correos inventados.
  if (intentos.size > 5000) intentos.clear();
}

const volver = (destino: string, cookie?: string) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: destino,
      'Cache-Control': 'no-store',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });

/** Solo rutas internas: un `ir` con host propio sería un redirector abierto. */
function destinoSeguro(v: FormDataEntryValue | null): string {
  const s = typeof v === 'string' ? v : '';
  return /^\/panel\/[a-z0-9/-]*$/i.test(s) ? s : '/panel/mis-leads/';
}

export const POST: APIRoute = async ({ request }) => {
  let datos: FormData;
  try {
    datos = await request.formData();
  } catch {
    return volver('/panel/entrar/?e=1');
  }

  if (datos.get('salir')) return volver('/panel/entrar/', cookieVacia());

  const correo = String(datos.get('correo') ?? '').trim().toLowerCase();
  const clave = String(datos.get('clave') ?? '');
  const ir = destinoSeguro(datos.get('ir'));

  if (!correo || !clave) return volver(`/panel/entrar/?e=1&ir=${encodeURIComponent(ir)}`);
  if (frenado(correo)) return volver(`/panel/entrar/?e=2&ir=${encodeURIComponent(ir)}`);

  let asesor = null;
  try {
    asesor = await asesorPorCorreo(correo);
  } catch {
    return volver(`/panel/entrar/?e=3&ir=${encodeURIComponent(ir)}`);
  }

  const ok = asesor?.activo === true && (await claveCorrecta(clave, asesor.clave_hash));
  if (!ok || !asesor) {
    fallo(correo);
    return volver(`/panel/entrar/?e=1&ir=${encodeURIComponent(ir)}`);
  }

  const cookie = await crearCookie({
    id: asesor.id,
    nombre: asesor.nombre,
    admin: asesor.admin === true,
  });
  // Sin secreto de firma no hay sesión posible: mejor decirlo que dejar
  // al asesor girando en un bucle de entrada sin explicación.
  if (!cookie) return volver(`/panel/entrar/?e=4&ir=${encodeURIComponent(ir)}`);

  intentos.delete(correo);
  await anotarAcceso(asesor.id);
  return volver(ir, atributosCookie(cookie, 12 * 3600));
};

/** Salir también por GET, para poder ponerlo como enlace en la cabecera. */
export const GET: APIRoute = async ({ url }) =>
  url.searchParams.has('salir')
    ? volver('/panel/entrar/', cookieVacia())
    : volver('/panel/entrar/');
