/**
 * Sesión del asesor — Fase 5.
 *
 * El panel tenía una sola puerta: Basic auth con una clave compartida. Sirve
 * para dos personas de confianza, no para un equipo comercial donde cada quien
 * debe ver solo sus propios contactos. Aquí cada asesor entra con su correo y
 * su clave.
 *
 * Dos decisiones que conviene entender:
 *
 * 1. **La clave se guarda derivada, nunca en claro.** PBKDF2-SHA256 con sal
 *    propia por asesor y 210.000 iteraciones (lo que recomienda OWASP para
 *    SHA-256). Si alguien se llevara la tabla, no se lleva las claves.
 *
 * 2. **La sesión no se guarda en la base.** Es una cookie firmada con HMAC:
 *    el servidor no tiene que consultar nada para saber quién es, y no hay una
 *    tabla de sesiones que crezca sola. El precio es que una sesión no se
 *    puede revocar de golpe; por eso dura poco (12 horas) y por eso el id del
 *    asesor se vuelve a comprobar contra la base en cada pantalla.
 */

import { env } from './auth';

const DURACION_HORAS = 12;
export const COOKIE = 'vs_sesion';

/* ------------------------------------------------------------------ *
 * Utilidades de codificación
 * ------------------------------------------------------------------ */

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deB64url(txt: string): Uint8Array {
  const s = txt.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Igualdad en tiempo constante sobre texto ya normalizado. */
function igual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

/* ------------------------------------------------------------------ *
 * Claves
 * ------------------------------------------------------------------ */

const ITERACIONES = 210_000;

async function derivar(clave: string, sal: Uint8Array): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', enc.encode(clave), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal as unknown as BufferSource, iterations: ITERACIONES },
    material,
    256
  );
  return new Uint8Array(bits);
}

/** Devuelve el texto que se guarda en `asesores.clave_hash`. */
export async function hashearClave(clave: string): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(clave, sal);
  return `pbkdf2$${ITERACIONES}$${b64url(sal)}$${b64url(hash)}`;
}

/**
 * Comprueba una clave contra lo guardado.
 *
 * Nunca lanza: un `clave_hash` corrupto o de un formato futuro devuelve false,
 * que es lo correcto —negar el acceso— y no un 500 en la pantalla de entrada.
 */
export async function claveCorrecta(clave: string, guardado: string | null): Promise<boolean> {
  if (!guardado) return false;
  try {
    const [algo, iter, sal, hash] = guardado.split('$');
    if (algo !== 'pbkdf2') return false;
    const n = Number(iter);
    if (!Number.isInteger(n) || n < 1000 || n > 2_000_000) return false;
    const material = await crypto.subtle.importKey('raw', enc.encode(clave), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: deB64url(sal) as unknown as BufferSource, iterations: n },
      material,
      256
    );
    return igual(b64url(new Uint8Array(bits)), hash);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Cookie firmada
 * ------------------------------------------------------------------ */

export interface Sesion {
  id: string;
  nombre: string;
  admin: boolean;
  exp: number;
}

/**
 * Secreto de firma.
 *
 * Usa SESION_SECRETO si existe y, si no, PANEL_CLAVE — que ya está definida.
 * Así esto funciona sin pedirle al administrador una variable más el mismo día
 * que despliega. Consecuencia que conviene saber: cambiar PANEL_CLAVE cierra
 * la sesión de todos, lo cual, cuando se cambia una clave, es lo deseable.
 */
function secreto(): string | null {
  return env('SESION_SECRETO') || env('PANEL_CLAVE') || null;
}

async function firmar(texto: string, llave: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(llave),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(texto))));
}

export async function crearCookie(s: Omit<Sesion, 'exp'>): Promise<string | null> {
  const llave = secreto();
  if (!llave) return null;
  const exp = Date.now() + DURACION_HORAS * 3_600_000;
  const cuerpo = b64url(enc.encode(JSON.stringify({ ...s, exp })));
  return `${cuerpo}.${await firmar(cuerpo, llave)}`;
}

/** Devuelve la sesión si la firma es válida y no ha vencido; si no, null. */
export async function leerCookie(valor: string | undefined): Promise<Sesion | null> {
  const llave = secreto();
  if (!llave || !valor) return null;
  const corte = valor.lastIndexOf('.');
  if (corte < 1) return null;
  const cuerpo = valor.slice(0, corte);
  const firma = valor.slice(corte + 1);
  try {
    if (!igual(await firmar(cuerpo, llave), firma)) return null;
    const s = JSON.parse(new TextDecoder().decode(deB64url(cuerpo))) as Sesion;
    if (typeof s?.id !== 'string' || typeof s?.exp !== 'number') return null;
    if (s.exp < Date.now()) return null;
    return { id: s.id, nombre: String(s.nombre ?? ''), admin: s.admin === true, exp: s.exp };
  } catch {
    return null;
  }
}

/** Atributos de la cookie. `Secure` fuera de desarrollo; `Lax` basta: no hay
 *  ninguna acción destructiva por GET y el formulario de entrada es del sitio. */
export function atributosCookie(valor: string, segundos: number): string {
  const seguro = (env('NODE_ENV') ?? 'production') !== 'development' ? ' Secure;' : '';
  return `${COOKIE}=${valor}; Path=/; HttpOnly;${seguro} SameSite=Lax; Max-Age=${segundos}`;
}

export const cookieVacia = () => atributosCookie('', 0);
