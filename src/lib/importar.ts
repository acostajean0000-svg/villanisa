/**
 * Traer los asesores de AlterEstate — Fase 5.
 *
 * Escribirlos a mano es trabajo tonto y se cometen errores justo en el campo
 * que no perdona: el correo, que es lo que viaja al CRM como `related`. Un
 * carácter mal y el lead se va al round robin en vez de a su asesor.
 *
 * Dos decisiones que no son cosméticas:
 *
 * 1. **Se importan apagados.** Con 54 usuarios en el CRM —la mayoría cuentas
 *    viejas—, importarlos activos haría que la ruleta empezara a repartir
 *    leads a buzones muertos en el mismo minuto. Entran inactivos y el
 *    administrador enciende a los que de verdad trabajan.
 *
 * 2. **No se importa nada dos veces.** Se comparan por correo y por UID, de
 *    forma que pulsar el botón otra vez el mes que viene solo trae a los
 *    nuevos, sin duplicar a nadie ni pisar lo que ya se configuró a mano.
 */
import type { Agent } from './alterestate';
import { env } from './auth';
import { listarAsesores, crearAsesor, type Asesor } from './ruleta';

export interface Candidato {
  /** Lo que se guardará en `asesores.nombre`. */
  nombre: string;
  /** Correo del CRM: sirve de `ae_ref` y de correo de entrada al panel. */
  correo: string | null;
  /** UID de AlterEstate, como respaldo cuando no hay correo. */
  uid: string | null;
  telefono: string | null;
  /** Qué se usará como referencia en el CRM: el correo si existe, si no el UID. */
  ref: string | null;
  /** Ya está en la ruleta: no se vuelve a crear. */
  existe: boolean;
  /** Nombre con el que ya está guardado, para que el panel lo explique. */
  existeComo: string | null;
  /** Por qué no se puede importar, si es el caso. */
  problema: string | null;
}

/**
 * Pide los usuarios al CRM sin pasar por la caché de `getAgents()`.
 *
 * Esa caché existe para el build, donde la lista se consulta muchas veces y no
 * cambia. Aquí es al revés: el administrador pulsa el botón justo después de
 * dar de alta a alguien en AlterEstate, y una lista de hace un rato le haría
 * pensar que el CRM no lo tiene.
 */
async function agentesDelCRM(): Promise<Agent[]> {
  const dominio = env('ALTERESTATE_DOMAIN') || 'villanisainmobiliaria.com';
  const res = await fetch('https://secure.alterestate.com/api/v1/agents/', {
    headers: { domain: dominio, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`AlterEstate respondió ${res.status} al pedir los usuarios.`);
  const dato = (await res.json()) as Agent[] | { results?: Agent[] };
  return Array.isArray(dato) ? dato : (dato.results ?? []);
}

const texto = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

function nombreDe(a: Agent): string {
  const completo = texto(a.full_name, 80);
  if (completo) return completo;
  const partes = [texto(a.first_name, 40), texto(a.last_name, 40)].filter(Boolean);
  return partes.join(' ');
}

const ES_CORREO = /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i;

/**
 * Lista lo que hay en AlterEstate, marcado contra lo que ya está en la ruleta.
 *
 * No escribe nada: es la pantalla previa. Lanza si el CRM no responde, para
 * que el panel pueda decirlo en vez de mostrar una lista vacía que parecería
 * «no tiene asesores».
 */
export async function candidatos(): Promise<Candidato[]> {
  const [agentes, actuales] = await Promise.all([agentesDelCRM(), listarAsesores()]);
  if (!agentes.length) throw new Error('AlterEstate no devolvió ningún usuario.');

  // Índices de lo que ya existe. Se mira `ae_ref` y `correo` porque un asesor
  // creado a mano pudo quedar con uno y no con el otro.
  const vistos = new Map<string, Asesor>();
  for (const a of actuales) {
    for (const clave of [a.ae_ref, (a as Asesor & { correo?: string }).correo]) {
      const k = texto(clave, 160).toLowerCase();
      if (k) vistos.set(k, a);
    }
  }

  const lista: Candidato[] = [];
  const yaEnLaLista = new Set<string>();

  for (const ag of agentes) {
    const nombre = nombreDe(ag);
    const correoBruto = texto(ag.email, 160).toLowerCase();
    const correo = ES_CORREO.test(correoBruto) ? correoBruto : null;
    const uid = texto(ag.uid, 40) || null;
    const ref = correo ?? uid;

    let problema: string | null = null;
    if (!nombre) problema = 'sin nombre en el CRM';
    else if (!ref) problema = 'sin correo ni UID: la ruleta no podría asignarle en el CRM';

    // El propio CRM repite usuarios; traer el duplicado no arregla el original.
    const huella = (ref ?? nombre).toLowerCase();
    if (yaEnLaLista.has(huella)) continue;
    yaEnLaLista.add(huella);

    const encontrado =
      (correo && vistos.get(correo)) || (uid && vistos.get(uid.toLowerCase())) || null;

    lista.push({
      nombre,
      correo,
      uid,
      telefono: texto(ag.phone, 40) || null,
      ref,
      existe: Boolean(encontrado),
      existeComo: encontrado ? encontrado.nombre : null,
      problema,
    });
  }

  // Primero los que se pueden traer; dentro de cada grupo, por nombre.
  return lista.sort((a, b) => {
    const pa = a.existe || a.problema ? 1 : 0;
    const pb = b.existe || b.problema ? 1 : 0;
    return pa - pb || a.nombre.localeCompare(b.nombre, 'es');
  });
}

export interface Resultado {
  creados: string[];
  omitidos: Array<{ nombre: string; motivo: string }>;
}

/**
 * Crea en la ruleta los asesores elegidos.
 *
 * `refs` son las referencias que el panel envió marcadas. Se vuelve a pedir la
 * lista en vez de confiar en lo que llegó del navegador: entre que se pintó la
 * pantalla y se pulsó el botón alguien pudo crear a ese asesor a mano, y así
 * no se duplica.
 */
export async function importar(refs: string[]): Promise<Resultado> {
  const pedidas = new Set(refs.map((r) => texto(r, 160).toLowerCase()).filter(Boolean));
  if (!pedidas.size) return { creados: [], omitidos: [] };

  const lista = await candidatos();
  const res: Resultado = { creados: [], omitidos: [] };

  for (const c of lista) {
    if (!c.ref || !pedidas.has(c.ref.toLowerCase())) continue;
    if (c.problema) {
      res.omitidos.push({ nombre: c.nombre, motivo: c.problema });
      continue;
    }
    if (c.existe) {
      res.omitidos.push({ nombre: c.nombre, motivo: 'ya estaba en la ruleta' });
      continue;
    }
    try {
      await crearAsesor({
        nombre: c.nombre,
        ae_ref: c.ref,
        telefono: c.telefono ?? undefined,
        // El correo del CRM sirve también de correo de entrada al panel. Solo
        // falta que el administrador le asigne una clave.
        correo: c.correo,
        // Apagados a propósito: ver la cabecera de este archivo.
        activo: false,
      });
      res.creados.push(c.nombre);
    } catch (err) {
      res.omitidos.push({ nombre: c.nombre, motivo: (err as Error).message });
    }
  }
  return res;
}
