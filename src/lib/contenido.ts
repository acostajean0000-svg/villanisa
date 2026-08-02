/**
 * Capa de contenido propia.
 *
 * Las descripciones y títulos que edita el equipo NO viven en AlterEstate:
 * viven en el almacenamiento de Villanisa. Cuando existe un texto propio para
 * una propiedad, ese gana sobre el que venga del CRM.
 *
 * Es el primer paso real hacia dejar de depender del proveedor: a partir de
 * aquí, el contenido que más valor SEO tiene es un activo de la casa.
 */

export interface Override {
  descripcion?: string;
  titulo?: string;
  actualizado?: string;
  por?: string;
}

export type Overrides = Record<string, Override>;

export const RUTA_CONTENIDO = 'contenido/propiedades.json';

const env = (clave: string): string | undefined => {
  const enEjecucion =
    typeof process !== 'undefined' && process.env ? process.env[clave] : undefined;
  return enEjecucion ?? (import.meta.env as Record<string, string | undefined>)[clave];
};

let cache: Overrides | null = null;

/**
 * Lee los textos propios. Si el almacén todavía no existe o falla, devuelve
 * vacío: el sitio debe construirse igual, cayendo a los datos del CRM.
 */
export async function getOverrides(): Promise<Overrides> {
  if (cache) return cache;

  const token = env('BLOB_READ_WRITE_TOKEN');
  if (!token) {
    console.warn('[contenido] sin almacén configurado; se usan los textos del CRM');
    cache = {};
    return cache;
  }

  try {
    const { get } = await import('@vercel/blob');
    // Almacén privado: se lee con el token, no por URL pública.
    // useCache:false para que un texto recién guardado salga en este build.
    const res = await get(RUTA_CONTENIDO, { access: 'private', token, useCache: false });
    cache = res?.stream ? ((await new Response(res.stream).json()) as Overrides) : {};
    console.log(`[contenido] ${Object.keys(cache).length} textos propios cargados`);
  } catch (err) {
    console.warn('[contenido] no se pudo leer el almacén:', (err as Error).message);
    cache = {};
  }

  return cache;
}
