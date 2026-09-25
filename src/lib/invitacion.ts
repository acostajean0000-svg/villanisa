/**
 * Enlaces de invitación — Fase 5b.
 *
 * El problema que resuelven: si el administrador escribe la clave del asesor,
 * esa clave viaja por WhatsApp y la conocen dos personas. Con esto el
 * administrador genera un enlace, el asesor lo abre y escribe la clave que él
 * quiera, y nadie más la ve nunca.
 *
 * Tres propiedades que hacen que el enlace se pueda mandar por WhatsApp sin
 * miedo:
 *
 *   - **Se quema al usarse.** Al guardar la clave, la invitación se borra. Un
 *     enlace reenviado o filtrado después no sirve para nada.
 *   - **Caduca.** Siete días. Un enlace olvidado en un chat no es una puerta
 *     abierta para siempre.
 *   - **En la base solo está su hash.** Quien se lleve la tabla no puede usar
 *     las invitaciones, igual que no puede usar las claves.
 */
import { env } from './auth';
import type { AsesorAcceso } from './crm';

const DIAS = 7;
const TIEMPO_LIMITE = 8_000;

function credenciales(): { url: string; clave: string } {
  const url = (env('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const clave = env('SUPABASE_SERVICE_KEY') ?? '';
  if (!url || !clave) throw new Error('El almacén no está configurado.');
  return { url, clave };
}

const cabeceras = (clave: string, extra: Record<string, string> = {}) => ({
  apikey: clave,
  Authorization: `Bearer ${clave}`,
  'Content-Type': 'application/json',
  ...extra,
});

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 del token. No lleva sal: el token ya es aleatorio de 256 bits, así
 *  que no hay diccionario que probar contra él. */
async function huella(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return b64url(new Uint8Array(d));
}

/**
 * Crea (o renueva) la invitación de un asesor y devuelve el enlace completo.
 *
 * Generar una segunda invitación invalida la primera: es lo que se espera
 * cuando alguien dice «mándamelo otra vez, perdí el mensaje», y evita dejar
 * enlaces vivos rodando por ahí.
 */
export async function crearInvitacion(id: string, origen: string): Promise<string> {
  const cred = credenciales();
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const hasta = new Date(Date.now() + DIAS * 86_400_000).toISOString();

  const res = await fetch(`${cred.url}/rest/v1/asesores?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: cabeceras(cred.clave, { Prefer: 'return=minimal' }),
    body: JSON.stringify({ invitacion_hash: await huella(token), invitacion_hasta: hasta }),
    signal: AbortSignal.timeout(TIEMPO_LIMITE),
  });
  if (!res.ok) throw new Error(`El almacén respondió ${res.status}`);

  return `${origen.replace(/\/+$/, '')}/panel/clave/?t=${token}`;
}

/**
 * Comprueba un token y devuelve a quién pertenece.
 *
 * Devuelve null para cualquier fallo —token inventado, vencido, asesor
 * desactivado— sin decir cuál: la pantalla no debe servir para averiguar qué
 * invitaciones existen.
 */
export async function asesorDeInvitacion(token: string): Promise<AsesorAcceso | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  let cred;
  try {
    cred = credenciales();
  } catch {
    return null;
  }
  try {
    const h = await huella(token);
    const res = await fetch(
      `${cred.url}/rest/v1/asesores?select=*&invitacion_hash=eq.${encodeURIComponent(h)}&limit=1`,
      { headers: cabeceras(cred.clave), signal: AbortSignal.timeout(TIEMPO_LIMITE) }
    );
    if (!res.ok) return null;
    const a = ((await res.json()) as AsesorAcceso[])[0];
    if (!a || !a.activo) return null;

    const hasta = (a as AsesorAcceso & { invitacion_hasta?: string | null }).invitacion_hasta;
    if (!hasta || new Date(hasta).getTime() < Date.now()) return null;

    // Sin correo no hay con qué entrar después: mejor decirlo que dejar al
    // asesor poner una clave que no le servirá para nada.
    if (!a.correo) return null;

    return a;
  } catch {
    return null;
  }
}

/**
 * Guarda la clave nueva y quema la invitación, en una sola escritura.
 *
 * El filtro por `invitacion_hash` va en la propia consulta: si entre que se
 * pintó la pantalla y se envió el formulario el administrador generó otro
 * enlace, este deja de valer y no hay forma de colarse con el viejo.
 */
export async function usarInvitacion(token: string, hashClave: string): Promise<boolean> {
  const cred = credenciales();
  const h = await huella(token);
  const res = await fetch(
    `${cred.url}/rest/v1/asesores?invitacion_hash=eq.${encodeURIComponent(h)}`,
    {
      method: 'PATCH',
      headers: cabeceras(cred.clave, { Prefer: 'return=representation' }),
      body: JSON.stringify({
        clave_hash: hashClave,
        invitacion_hash: null,
        invitacion_hasta: null,
      }),
      signal: AbortSignal.timeout(TIEMPO_LIMITE),
    }
  );
  if (!res.ok) throw new Error(`El almacén respondió ${res.status}`);
  return ((await res.json()) as unknown[]).length > 0;
}

/** Cancela la invitación pendiente de un asesor, sin tocar su clave actual. */
export async function anularInvitacion(id: string): Promise<void> {
  const cred = credenciales();
  await fetch(`${cred.url}/rest/v1/asesores?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: cabeceras(cred.clave, { Prefer: 'return=minimal' }),
    body: JSON.stringify({ invitacion_hash: null, invitacion_hasta: null }),
    signal: AbortSignal.timeout(TIEMPO_LIMITE),
  });
}
