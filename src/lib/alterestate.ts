/**
 * Cliente de la API de AlterEstate.
 *
 * La API identifica a la empresa mediante la cabecera `domain`; no requiere
 * token para lectura. El envío de leads sí usa una API key privada que vive
 * únicamente en variables de entorno del servidor (nunca en el cliente).
 *
 * Docs: https://dev.alterestate.com
 */

const API = 'https://secure.alterestate.com/api/v1';
const DOMAIN = import.meta.env.ALTERESTATE_DOMAIN || 'villanisainmobiliaria.com';
const COUNTRY_RD = 149;

/* ------------------------------------------------------------------ tipos */

export interface PropertyListItem {
  cid: number;
  uid: string;
  slug: string;
  name: string;
  short_description?: string;
  featured_image?: string;
  category?: { id: number; name: string; name_en?: string };
  listing_type?: Array<{ id: number; listing: string }>;
  sale_price?: number | null;
  rent_price?: number | null;
  currency_sale?: string;
  currency_rent?: string;
  city?: string;
  sector?: string;
  province?: string;
  room?: number | null;
  bathroom?: number | null;
  half_bathrooms?: number | null;
  parkinglot?: number | null;
  property_area?: number | null;
  condition?: string | number | null;
}

export interface PropertyDetail extends PropertyListItem {
  description?: string;
  gallery_image?: Array<{ image?: string; url?: string } | string>;
  amenities?: Array<{ name?: string } | string>;
  tags?: Array<{ name?: string } | string>;
  agents?: Agent[];
  lat_long?: string | null;
  mapiframe?: string | null;
  virtual_tour?: string | null;
  youtubeiframe?: string | null;
  terrain_area?: number | null;
  floor_level?: number | null;
  total_floors?: number | null;
  year_construction?: number | null;
  furnished?: boolean;
  forSale?: boolean;
  forRent?: boolean;
  show_on_website?: boolean;
}

export interface Agent {
  id?: number;
  uid?: string;
  slug?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  avatar?: string;
  bio?: string;
  position?: string;
  instagram_username?: string;
  facebook_username?: string;
}

/* ------------------------------------------------------------- utilidades */

const headers = { domain: DOMAIN, Accept: 'application/json' };

/** GET con reintentos: un build no debe caerse por un fallo transitorio de red. */
async function get<T>(path: string, tries = 3): Promise<T | null> {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return (await res.json()) as T;
      // 404 es una respuesta legítima (recurso inexistente), no reintentar
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i === tries - 1) {
        console.warn(`[alterestate] falló ${url}: ${(err as Error).message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  return null;
}

/* Caché en memoria: durante un build, cada página no debe repedir lo mismo. */
const cache = new Map<string, unknown>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return cache.get(key) as T;
  const value = await fn();
  cache.set(key, value);
  return value;
}

/* ------------------------------------------------------------- consultas */

interface Paged<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/**
 * Descarga TODO el inventario recorriendo la paginación.
 * Tope de seguridad para que un `next` mal formado no genere un bucle infinito.
 */
export async function getAllProperties(): Promise<PropertyListItem[]> {
  return cached('all-properties', async () => {
    const all: PropertyListItem[] = [];
    const seen = new Set<string>();
    let url: string | null = `${API}/properties/filter/?country=${COUNTRY_RD}&page=1`;
    let guard = 0;

    while (url && guard++ < 50) {
      const page: Paged<PropertyListItem> | null = await get(url);
      if (!page) break;
      for (const p of page.results ?? []) {
        if (p?.uid && !seen.has(p.uid)) {
          seen.add(p.uid);
          all.push(p);
        }
      }
      url = page.next;
    }

    console.log(`[alterestate] ${all.length} propiedades cargadas`);
    return all;
  });
}

export async function getProperty(slug: string): Promise<PropertyDetail | null> {
  return cached(`prop:${slug}`, () =>
    get<PropertyDetail>(`/properties/view/${encodeURIComponent(slug)}/`)
  );
}

export async function getAgents(): Promise<Agent[]> {
  return cached('agents', async () => {
    const data = await get<Agent[] | Paged<Agent>>('/agents/');
    if (!data) return [];
    return Array.isArray(data) ? data : (data.results ?? []);
  });
}

/* ------------------------------------------------ normalización y helpers */

export const slugify = (s: string): string =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/* ------------------------------------------------------------ monedas */

/**
 * Más de la mitad del inventario se publica en pesos dominicanos. Comparar,
 * ordenar o promediar precios sin normalizar produce disparates: RD$11,000,000
 * es un número mayor que US$300,000 pero vale bastante menos.
 *
 * Cada propiedad se SIGUE MOSTRANDO en su moneda original; la conversión es
 * solo para ordenar, filtrar y calcular estadísticas.
 */
const DOP_POR_USD_RESPALDO = 58;
let tasaCache: number | null = null;

export async function getTasaDOP(): Promise<number> {
  if (tasaCache) return tasaCache;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const j = await r.json();
    const t = j?.rates?.DOP;
    // Rango de cordura: si la API devuelve algo absurdo, mejor el respaldo
    tasaCache = typeof t === 'number' && t > 20 && t < 200 ? t : DOP_POR_USD_RESPALDO;
  } catch {
    tasaCache = DOP_POR_USD_RESPALDO;
  }
  console.log(`[alterestate] tasa DOP/USD = ${tasaCache}`);
  return tasaCache;
}

export function toUSD(amount: number, currency: string, tasa: number): number {
  return currency === 'DOP' ? amount / tasa : amount;
}

/** Precio de la propiedad normalizado a dólares, para comparar manzanas con manzanas. */
export function usdOf(p: PropertyListItem, tasa: number): number | null {
  const { amount, currency } = priceOf(p);
  return amount ? toUSD(amount, currency, tasa) : null;
}

export function priceOf(p: PropertyListItem): { amount: number | null; currency: string } {
  const amount = p.sale_price || p.rent_price || null;
  const currency = (p.sale_price ? p.currency_sale : p.currency_rent) || 'USD';
  return { amount, currency };
}

export function formatPrice(amount: number | null, currency = 'USD'): string {
  if (!amount) return 'Precio a consultar';
  const symbol = currency === 'DOP' ? 'RD$' : 'US$';
  return `${symbol}${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** Imagen destacada con respaldo a la primera de la galería. */
export function imageOf(p: PropertyDetail | PropertyListItem): string | null {
  if (p.featured_image) return p.featured_image;
  const gallery = (p as PropertyDetail).gallery_image;
  if (Array.isArray(gallery) && gallery.length) {
    const first = gallery[0];
    return typeof first === 'string' ? first : (first.image ?? first.url ?? null);
  }
  return null;
}

/** Normaliza la galería, que la API devuelve con formas distintas. */
export function galleryOf(p: PropertyDetail): string[] {
  const raw = p.gallery_image;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => (typeof g === 'string' ? g : (g.image ?? g.url ?? null)))
    .filter((x): x is string => Boolean(x));
}

/* ------------------------------------------------- imágenes de alta calidad */

/**
 * El CDN de AlterEstate es un AWS Serverless Image Handler: la ruta de la URL
 * es un JSON en base64 con las transformaciones a aplicar. Por defecto la API
 * entrega 350x250 en JPEG calidad 70 — insuficiente para pantallas Retina,
 * donde una tarjeta necesita ~900px reales.
 *
 * Reescribimos ese payload para pedir el tamaño y formato que nos convenga.
 * El original completo vive en S3, así que no estamos ampliando una miniatura:
 * estamos pidiendo un recorte nuevo desde la fuente.
 */
export function aeImage(
  url: string | null | undefined,
  width: number,
  opts: {
    height?: number;
    quality?: number;
    format?: 'webp' | 'jpeg';
    /** 'cover' recorta en el CDN (útil cuando el CSS ya recorta igual);
     *  'inside' conserva la foto completa dentro del cuadro. */
    fit?: 'cover' | 'inside';
  } = {}
): string {
  if (!url) return '';
  const { height, quality = 82, format = 'webp', fit = 'inside' } = opts;

  const m = url.match(/^(https?:\/\/[^/]+)\/(.+)$/);
  if (!m) return url;

  try {
    const payload = JSON.parse(atob(m[2]));
    if (!payload?.bucket || !payload?.key) return url;

    const next = {
      bucket: payload.bucket,
      key: payload.key,
      edits: {
        resize: {
          width,
          ...(height ? { height } : {}),
          fit,
          // Parte del inventario tiene originales de ~700px (fincas, fichas
          // viejas). Sin esto el CDN los ampliaría: más bytes y peor nitidez.
          withoutEnlargement: true,
        },
        toFormat: format,
        [format]: { quality },
      },
    };

    return `${m[1]}/${btoa(JSON.stringify(next))}`;
  } catch {
    // No es un payload del image handler (logo, avatar externo, etc.)
    return url;
  }
}

/** srcset por anchos reales, para que cada pantalla descargue solo lo suyo. */
export function aeSrcSet(
  url: string | null | undefined,
  widths: number[],
  ratio?: number,
  fit: 'cover' | 'inside' = 'inside'
): string {
  if (!url) return '';
  return widths
    .map((w) => {
      const h = ratio ? Math.round(w / ratio) : undefined;
      return `${aeImage(url, w, { height: h, fit })} ${w}w`;
    })
    .join(', ');
}

export function namesOf(list: Array<{ name?: string } | string> | undefined): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => (typeof x === 'string' ? x : x.name))
    .filter((x): x is string => Boolean(x));
}

export const isForSale = (p: PropertyListItem): boolean =>
  Boolean(p.sale_price) || (p.listing_type ?? []).some((l) => l.id === 1);

/** Agrupa el inventario por sector para generar las páginas de aterrizaje. */
export interface SectorGroup {
  sector: string;
  city: string;
  slug: string;
  properties: PropertyListItem[];
}

export function groupBySector(props: PropertyListItem[], min = 2): SectorGroup[] {
  const map = new Map<string, SectorGroup>();
  for (const p of props) {
    if (!p.sector || !p.city) continue;
    const slug = `${slugify(p.city)}/${slugify(p.sector)}`;
    if (!map.has(slug)) {
      map.set(slug, { sector: p.sector, city: p.city, slug, properties: [] });
    }
    map.get(slug)!.properties.push(p);
  }
  // Una página con una sola propiedad es una página débil para SEO.
  return [...map.values()]
    .filter((g) => g.properties.length >= min)
    .sort((a, b) => b.properties.length - a.properties.length);
}
