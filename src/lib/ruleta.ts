/**
 * Ruleta propia de asesores — Fase 4.
 *
 * AlterEstate reparte los leads de sus propias fuentes; esta ruleta reparte
 * los del sitio, con tres cosas que la suya no puede dar:
 *
 *   - Reglas que el CRM no conoce: zona, horario, vacaciones.
 *   - Reasignar por silencio. El dato de "ya lo contacté" vive en esta base
 *     (Fase 3), no en AlterEstate, así que solo desde aquí se puede quitarle
 *     un lead a quien no contestó.
 *   - Visibilidad: quién recibió qué y a quién le toca.
 *
 * La elección del turno NO se hace aquí sino en la base, con una función
 * atómica (ver supabase/03-ruleta.sql). Elegir y marcar tienen que ser una
 * sola operación o dos leads simultáneos le caen al mismo asesor.
 */
import { env } from './auth';

export interface Asesor {
  id: string;
  nombre: string;
  ae_ref: string | null;
  telefono: string | null;
  activo: boolean;
  orden: number;
  zonas: string[];
  hora_desde: number | null;
  hora_hasta: number | null;
  pausado_hasta: string | null;
  ae_rechazado: boolean;
  ae_detalle: string | null;
  recibidos: number;
  ultimo_en: string | null;
  creado_en: string;
}

const TIEMPO_LIMITE = 8_000;

function credenciales(): { url: string; clave: string } | null {
  const url = (env('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const clave = env('SUPABASE_SERVICE_KEY') ?? '';
  if (!url || !clave) return null;
  return { url, clave };
}

const cabeceras = (clave: string, extra: Record<string, string> = {}) => ({
  apikey: clave,
  Authorization: `Bearer ${clave}`,
  'Content-Type': 'application/json',
  ...extra,
});

/**
 * A quién le toca este lead.
 *
 * Devuelve null —nunca lanza— si la ruleta no está configurada, si no hay
 * nadie disponible o si la base falla. Quien llama debe seguir adelante: sin
 * asesor propio, el lead igual entra a AlterEstate y lo reparte su regla.
 * Una ruleta caída no puede ser el motivo de perder un comprador.
 */
export async function siguienteAsesor(zona?: string | null): Promise<Asesor | null> {
  const cred = credenciales();
  if (!cred) return null;

  try {
    const res = await fetch(`${cred.url}/rest/v1/rpc/siguiente_asesor`, {
      method: 'POST',
      headers: cabeceras(cred.clave),
      body: JSON.stringify({ p_zona: zona || null }),
      signal: AbortSignal.timeout(TIEMPO_LIMITE),
    });
    if (!res.ok) {
      console.error('[ruleta] no se pudo repartir:', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const dato = await res.json();
    // La función devuelve la fila, o null si no hay nadie disponible.
    const a = (Array.isArray(dato) ? dato[0] : dato) as Asesor | null;
    return a && a.id ? a : null;
  } catch (err) {
    console.error('[ruleta] error al repartir:', (err as Error).message);
    return null;
  }
}

/**
 * AlterEstate rechazó la referencia de este asesor.
 *
 * Se marca para que deje de tocarle turno. Antes, un correo viejo arrastrado
 * en una ficha tumbaba el lead entero cada vez; ahora falla una vez, se anota
 * y el problema queda visible en el panel para que alguien lo corrija.
 */
export async function marcarRefRechazada(id: string, detalle: string): Promise<void> {
  const cred = credenciales();
  if (!cred) return;
  try {
    await fetch(`${cred.url}/rest/v1/asesores?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: cabeceras(cred.clave, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ ae_rechazado: true, ae_detalle: detalle.slice(0, 400) }),
      signal: AbortSignal.timeout(TIEMPO_LIMITE),
    });
  } catch (err) {
    console.error('[ruleta] no se pudo marcar la referencia:', (err as Error).message);
  }
}

/** Todos los asesores, en el orden en que se muestran en el panel. */
export async function listarAsesores(): Promise<Asesor[]> {
  const cred = credenciales();
  if (!cred) throw new Error('La ruleta no está configurada.');

  const res = await fetch(
    `${cred.url}/rest/v1/asesores?select=*&order=activo.desc,orden.asc,nombre.asc`,
    { headers: cabeceras(cred.clave), signal: AbortSignal.timeout(TIEMPO_LIMITE) }
  );
  if (!res.ok) throw new Error(`El almacén respondió ${res.status}`);
  return (await res.json()) as Asesor[];
}

/** Campos que el panel puede tocar. El resto (recibidos, ultimo_en) lo lleva la rotación. */
export type CambioAsesor = Partial<
  Pick<
    Asesor,
    | 'nombre'
    | 'ae_ref'
    | 'telefono'
    | 'activo'
    | 'orden'
    | 'zonas'
    | 'hora_desde'
    | 'hora_hasta'
    | 'pausado_hasta'
    | 'ae_rechazado'
  >
>;

export async function guardarAsesor(id: string, cambios: CambioAsesor): Promise<void> {
  const cred = credenciales();
  if (!cred) throw new Error('La ruleta no está configurada.');
  // Corregir a mano una referencia implica darle otra oportunidad.
  const parche = { ...cambios, ...(cambios.ae_ref !== undefined ? { ae_rechazado: false, ae_detalle: null } : {}) };
  const res = await fetch(`${cred.url}/rest/v1/asesores?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: cabeceras(cred.clave, { Prefer: 'return=minimal' }),
    body: JSON.stringify(parche),
    signal: AbortSignal.timeout(TIEMPO_LIMITE),
  });
  if (!res.ok) throw new Error(`El almacén respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * Crea un asesor.
 *
 * Acepta `correo` aunque no sea parte de `CambioAsesor`: ese campo pertenece al
 * acceso al panel (Fase 5) y no a la rotación, pero al importar desde
 * AlterEstate viene en el mismo paquete y separarlo en dos escrituras dejaría
 * la puerta abierta a asesores creados a medias.
 */
export async function crearAsesor(
  datos: CambioAsesor & { nombre: string; correo?: string | null }
): Promise<void> {
  const cred = credenciales();
  if (!cred) throw new Error('La ruleta no está configurada.');
  const res = await fetch(`${cred.url}/rest/v1/asesores`, {
    method: 'POST',
    headers: cabeceras(cred.clave, { Prefer: 'return=minimal' }),
    body: JSON.stringify([datos]),
    signal: AbortSignal.timeout(TIEMPO_LIMITE),
  });
  if (!res.ok) throw new Error(`El almacén respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function borrarAsesor(id: string): Promise<void> {
  const cred = credenciales();
  if (!cred) throw new Error('La ruleta no está configurada.');
  const res = await fetch(`${cred.url}/rest/v1/asesores?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: cabeceras(cred.clave, { Prefer: 'return=minimal' }),
    signal: AbortSignal.timeout(TIEMPO_LIMITE),
  });
  if (!res.ok) throw new Error(`El almacén respondió ${res.status}`);
}

/** ¿Está disponible ahora mismo? Para pintarlo en el panel sin repetir la regla. */
export function disponibleAhora(a: Asesor, ahora = new Date()): boolean {
  if (!a.activo || a.ae_rechazado) return false;
  if (a.pausado_hasta && new Date(a.pausado_hasta) > ahora) return false;
  if (a.hora_desde === null || a.hora_hasta === null) return true;
  // Misma hora que usa la función de la base: hora local dominicana.
  const h = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Santo_Domingo',
      hour: 'numeric',
      hour12: false,
    }).format(ahora)
  ) % 24;
  return a.hora_desde <= a.hora_hasta
    ? h >= a.hora_desde && h <= a.hora_hasta
    : h >= a.hora_desde || h <= a.hora_hasta;
}
