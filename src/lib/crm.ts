/**
 * CRM propio — Fase 5.
 *
 * Lo que faltaba para que el sistema pueda vivir sin AlterEstate: el lead deja
 * de ser una fila que se mira y pasa a ser algo que se trabaja. Etapas con
 * historial, notas, y consultas que ya saben de quién es cada contacto.
 *
 * Todo lo de aquí se usa SOLO desde el servidor: la clave del almacén tiene
 * permiso total sobre las tablas.
 */
import { env } from './auth';
import type { LeadGuardado } from './leads';
import type { Asesor } from './ruleta';

/* ------------------------------------------------------------------ *
 * Catálogo de etapas
 * ------------------------------------------------------------------ */

export const ETAPAS = ['nuevo', 'contactado', 'visita', 'negociacion', 'cerrado', 'perdido'] as const;
export type Etapa = (typeof ETAPAS)[number];

export const ETAPA_NOMBRE: Record<Etapa, string> = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  visita: 'Visita',
  negociacion: 'Negociación',
  cerrado: 'Cerrado',
  perdido: 'Perdido',
};

/** Etapas en las que el lead ya no se trabaja: no cuentan como pendientes. */
export const ETAPAS_CERRADAS: Etapa[] = ['cerrado', 'perdido'];

export const esEtapa = (v: unknown): v is Etapa =>
  typeof v === 'string' && (ETAPAS as readonly string[]).includes(v);

export interface LeadCRM extends LeadGuardado {
  etapa: Etapa;
  etapa_en: string;
  etapa_por: string | null;
  motivo_perdida: string | null;
}

export interface Nota {
  id: string;
  lead_id: string;
  autor: string;
  autor_id: string | null;
  texto: string;
  creado_en: string;
}

export type Rol = 'asesor' | 'gerente' | 'admin';

export interface AsesorAcceso extends Asesor {
  correo: string | null;
  clave_hash: string | null;
  admin: boolean;
  /** Fase 6. `admin` se mantiene por compatibilidad con lo ya guardado. */
  rol: Rol;
  gerente_id: string | null;
  ultimo_acceso: string | null;
  /** Fase 5b: hasta cuándo vale la invitación pendiente, si la hay. */
  invitacion_hasta?: string | null;
}

/* ------------------------------------------------------------------ *
 * Fontanería
 * ------------------------------------------------------------------ */

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

function cred() {
  const c = credenciales();
  if (!c) throw new Error('El almacén no está configurado.');
  return c;
}

async function pedir(ruta: string, init: RequestInit = {}): Promise<Response> {
  const c = cred();
  const res = await fetch(`${c.url}/rest/v1/${ruta}`, {
    ...init,
    headers: cabeceras(c.clave, (init.headers as Record<string, string>) ?? {}),
    signal: AbortSignal.timeout(TIEMPO_LIMITE),
  });
  if (!res.ok) throw new Error(`El almacén respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

/* ------------------------------------------------------------------ *
 * Acceso de asesores
 * ------------------------------------------------------------------ */

/**
 * Busca al asesor por correo para la pantalla de entrada.
 *
 * Devuelve null si no existe. Quien llama NO debe distinguir en el mensaje
 * entre "ese correo no existe" y "la clave no es": decirlo confirma qué
 * correos están dados de alta.
 */
export async function asesorPorCorreo(correo: string): Promise<AsesorAcceso | null> {
  const limpio = correo.trim().toLowerCase();
  if (!limpio) return null;
  const res = await pedir(
    `asesores?select=*&correo=ilike.${encodeURIComponent(limpio)}&limit=1`
  );
  const filas = (await res.json()) as AsesorAcceso[];
  return filas[0] ?? null;
}

/** Relee al asesor por id: la cookie dice quién dijo ser, la base dice quién es. */
export async function asesorPorId(id: string): Promise<AsesorAcceso | null> {
  const res = await pedir(`asesores?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  const filas = (await res.json()) as AsesorAcceso[];
  return filas[0] ?? null;
}

export async function anotarAcceso(id: string): Promise<void> {
  try {
    await pedir(`asesores?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ultimo_acceso: new Date().toISOString() }),
    });
  } catch {
    /* informativo: que falle no puede impedir entrar */
  }
}

export async function guardarClave(id: string, hash: string): Promise<void> {
  await pedir(`asesores?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ clave_hash: hash }),
  });
}

/**
 * Correo de acceso y rango.
 *
 * Quitarle el correo a alguien también le quita la clave: dejar un hash
 * huérfano asociado a un correo que mañana se le asigna a otra persona es
 * justo el descuido con el que se hereda una cuenta ajena.
 */
export async function guardarAcceso(
  id: string,
  cambios: { correo?: string | null; admin?: boolean; rol?: Rol; gerente_id?: string | null }
): Promise<void> {
  const parche: Record<string, unknown> = {};
  if (cambios.correo !== undefined) {
    const c = cambios.correo ? cambios.correo.trim().toLowerCase() : null;
    parche.correo = c;
    if (!c) parche.clave_hash = null;
  }
  if (cambios.admin !== undefined) parche.admin = cambios.admin === true;
  if (cambios.rol !== undefined) {
    parche.rol = cambios.rol;
    // `admin` es la marca vieja de la Fase 5. Se mantiene al día con el rol
    // para que no queden dos verdades contradictorias en la misma fila.
    parche.admin = cambios.rol === 'admin';
    // Un gerente o un administrador no entra en la rotación, así que tampoco
    // debe colgar de otro gerente: su equipo lo definen sus asesores.
    if (cambios.rol !== 'asesor') parche.gerente_id = null;
  }
  if (cambios.gerente_id !== undefined && parche.gerente_id === undefined) {
    parche.gerente_id = cambios.gerente_id || null;
  }
  if (!Object.keys(parche).length) return;
  await pedir(`asesores?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(parche),
  });
}

/* ------------------------------------------------------------------ *
 * Leads
 * ------------------------------------------------------------------ */

/**
 * Leads de un asesor.
 *
 * El filtro por `asesor_id` va en la consulta, no en un `.filter()` después:
 * si un día esta función se equivoca, el error debe ser "no veo nada", no
 * "veo los contactos de mis compañeros".
 */
export async function leadsDeAsesor(asesorId: string, limite = 300): Promise<LeadCRM[]> {
  const res = await pedir(
    `leads?select=*&asesor_id=eq.${encodeURIComponent(asesorId)}` +
      `&order=creado_en.desc&limit=${Math.min(limite, 1000)}`
  );
  return (await res.json()) as LeadCRM[];
}

/**
 * Los asesores de un gerente.
 *
 * Un solo nivel: el equipo son sus asesores directos, no los asesores de otro
 * gerente que dependa de él. Villanisa tiene dos niveles, y una jerarquía
 * recursiva aquí sería complejidad pagada por adelantado para un caso que no
 * existe.
 */
export async function equipoDe(gerenteId: string): Promise<AsesorAcceso[]> {
  const res = await pedir(
    `asesores?select=*&gerente_id=eq.${encodeURIComponent(gerenteId)}&order=nombre.asc`
  );
  return (await res.json()) as AsesorAcceso[];
}

/**
 * Leads de un conjunto de asesores.
 *
 * Con la lista vacía devuelve vacío SIN consultar: un `in.()` sin valores es un
 * error de PostgREST, y un gerente recién creado sin equipo vería un fallo
 * donde lo correcto es «todavía no tiene a nadie».
 */
export async function leadsDeEquipo(asesorIds: string[], limite = 500): Promise<LeadCRM[]> {
  if (!asesorIds.length) return [];
  const lista = asesorIds.slice(0, 200).map((i) => `"${i}"`).join(',');
  const res = await pedir(
    `leads?select=*&asesor_id=in.(${encodeURIComponent(lista)})` +
      `&order=creado_en.desc&limit=${Math.min(limite, 1000)}`
  );
  return (await res.json()) as LeadCRM[];
}

export async function todosLosLeads(limite = 500): Promise<LeadCRM[]> {
  const res = await pedir(`leads?select=*&order=creado_en.desc&limit=${Math.min(limite, 1000)}`);
  return (await res.json()) as LeadCRM[];
}

export async function leadPorId(id: string): Promise<LeadCRM | null> {
  const res = await pedir(`leads?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  const filas = (await res.json()) as LeadCRM[];
  return filas[0] ?? null;
}

/**
 * Cambia la etapa y deja constancia.
 *
 * Tres cosas pasan juntas a propósito:
 *
 *   - Se escribe la etapa nueva.
 *   - Se apunta el salto en el historial (de dónde a dónde, quién, cuándo).
 *   - Si el lead todavía no estaba atendido y la etapa nueva implica que sí
 *     lo está, se marca atendido. Que un asesor tenga que llamar Y ADEMÁS
 *     acordarse de pulsar "atendido" es como se corrompe una métrica.
 *
 * Devuelve false si el lead no existe o si la etapa no cambió.
 */
export async function cambiarEtapa(
  id: string,
  nueva: Etapa,
  quien: string,
  motivo?: string
): Promise<boolean> {
  const actual = await leadPorId(id);
  if (!actual) return false;
  const anterior = (actual.etapa ?? 'nuevo') as Etapa;
  if (anterior === nueva && !motivo) return false;

  const parche: Record<string, unknown> = {
    etapa: nueva,
    etapa_en: new Date().toISOString(),
    etapa_por: quien.slice(0, 80),
    motivo_perdida: nueva === 'perdido' ? (motivo ?? actual.motivo_perdida ?? null) : null,
  };
  // 'nuevo' es el único estado que no implica contacto.
  if (!actual.atendido_en && nueva !== 'nuevo') {
    parche.atendido_en = new Date().toISOString();
    parche.atendido_por = quien.slice(0, 80);
  }

  await pedir(`leads?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(parche),
  });

  try {
    await pedir('lead_etapas', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ lead_id: id, de: anterior, a: nueva, por: quien.slice(0, 80) }]),
    });
  } catch (err) {
    // El historial es para analizar después; el estado ya quedó bien.
    console.error('[crm] no se pudo anotar el salto de etapa:', (err as Error).message);
  }
  return true;
}

/** Reasignación manual desde el tablero. Limpia el aviso para que el nuevo
 *  dueño estrene su propio plazo, igual que en la reasignación automática. */
export async function asignarA(id: string, asesor: { id: string; nombre: string }): Promise<void> {
  await pedir(`leads?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      asesor_id: asesor.id,
      asignado_a: `asignado a mano: ${asesor.nombre}`,
      alertado_en: null,
    }),
  });
}

/* ------------------------------------------------------------------ *
 * Notas
 * ------------------------------------------------------------------ */

export async function notasDe(leadId: string): Promise<Nota[]> {
  const res = await pedir(
    `lead_notas?select=*&lead_id=eq.${encodeURIComponent(leadId)}&order=creado_en.desc&limit=100`
  );
  return (await res.json()) as Nota[];
}

/** Notas de varios leads de una vez, para pintar la lista sin N consultas. */
export async function notasDeVarios(ids: string[]): Promise<Map<string, Nota[]>> {
  const mapa = new Map<string, Nota[]>();
  if (!ids.length) return mapa;
  const lista = ids.slice(0, 200).map((i) => `"${i}"`).join(',');
  const res = await pedir(
    `lead_notas?select=*&lead_id=in.(${encodeURIComponent(lista)})&order=creado_en.desc&limit=1000`
  );
  for (const n of (await res.json()) as Nota[]) {
    const v = mapa.get(n.lead_id) ?? [];
    v.push(n);
    mapa.set(n.lead_id, v);
  }
  return mapa;
}

export async function agregarNota(
  leadId: string,
  autor: string,
  autorId: string | null,
  texto: string
): Promise<void> {
  const limpio = texto.trim().slice(0, 4000);
  if (!limpio) throw new Error('La nota está vacía.');
  await pedir('lead_notas', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([
      { lead_id: leadId, autor: autor.slice(0, 80), autor_id: autorId, texto: limpio },
    ]),
  });
}

/* ------------------------------------------------------------------ *
 * Embudo
 * ------------------------------------------------------------------ */

export function embudo(leads: LeadCRM[]): Record<Etapa, number> {
  const cuenta = Object.fromEntries(ETAPAS.map((e) => [e, 0])) as Record<Etapa, number>;
  for (const l of leads) {
    const e = (l.etapa ?? 'nuevo') as Etapa;
    if (esEtapa(e)) cuenta[e]++;
  }
  return cuenta;
}

/** Teléfono en formato wa.me. Devuelve null si no hay dígitos suficientes. */
export function enlaceWhatsApp(telefono: string | undefined, texto?: string): string | null {
  const d = (telefono ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  // República Dominicana: 809/829/849 sin prefijo de país es lo habitual.
  const num = d.length === 10 ? `1${d}` : d;
  const t = texto ? `?text=${encodeURIComponent(texto)}` : '';
  return `https://wa.me/${num}${t}`;
}
