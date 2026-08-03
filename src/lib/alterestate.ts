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

/**
 * Un precio se considera un error de carga, no una propiedad de lujo.
 *
 * Aparecieron fichas a RD$8,500,000,000 (unos US$146 millones) — ceros de más
 * tecleados en el CRM. Como el listado ordena por precio, esos errores se
 * quedaban con el primer lugar de la página. El tope es deliberadamente alto:
 * en RD existen propiedades de varios millones de dólares, pero no de cien.
 */
export const TOPE_PRECIO_USD = 10_000_000;

/**
 * Y el suelo, que faltaba. El tope evitaba los RD$8,500,000,000, pero por
 * abajo se colaban rentas mensuales y precios por metro cuadrado cargados en
 * el campo de venta: la página de zona llegó a anunciar "apartamentos desde
 * US$119". En RD no existe vivienda en venta por menos de US$10.000.
 */
export const SUELO_PRECIO_USD = 10_000;

export function precioPlausible(p: PropertyListItem, tasa: number): boolean {
  const usd = usdOf(p, tasa);
  return usd === null || (usd >= SUELO_PRECIO_USD && usd <= TOPE_PRECIO_USD);
}

/**
 * Un precio sirve para calcular estadísticas de zona solo si es de venta y es
 * creíble. `precioPlausible` acepta null (una ficha sin precio es válida y se
 * muestra); una estadística, no.
 */
export function precioParaEstadistica(p: PropertyListItem, tasa: number): number | null {
  if (!isForSale(p)) return null;
  const usd = usdOf(p, tasa);
  if (usd === null || usd < SUELO_PRECIO_USD || usd > TOPE_PRECIO_USD) return null;
  return usd;
}

/**
 * El CRM guarda el código de moneda sin normalizar: en el inventario conviven
 * `USD` (117), `DOP` (53) y `US` (4) en venta, y `DOP` (108), `USD` (6) y
 * `RD` (10) en alquiler. El resto del código compara contra 'DOP', así que un
 * `RD` se tomaba por dólares: el mismo número, multiplicado por 58.
 */
export function normalizarMoneda(c: string | null | undefined): string {
  const s = (c ?? '').trim().toUpperCase();
  if (s === 'RD' || s === 'RD$' || s === 'DOP') return 'DOP';
  if (s === 'US' || s === 'US$' || s === 'USD') return 'USD';
  return s || 'USD';
}

export function priceOf(p: PropertyListItem): { amount: number | null; currency: string } {
  const amount = p.sale_price || p.rent_price || null;
  const bruta = p.sale_price ? p.currency_sale : p.currency_rent;
  return { amount, currency: normalizarMoneda(bruta) };
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
/** Host del image handler. Es el único que sabe transformar. */
const CDN_TRANSFORMA = 'https://d2kflbb1pmooh4.cloudfront.net';

/**
 * AlterEstate entrega las fotos en DOS formatos distintos según de dónde vengan:
 *
 *   galería  → https://d2kflbb1pmooh4…/<payload base64>   (image handler)
 *   portada  → https://d2p0bx8wfdkjkb…/static/properties/…/IMG_1982.jpeg
 *
 * Durante semanas el código solo entendió el primero: con el segundo, atob()
 * lanzaba excepción, el catch devolvía la URL intacta y el srcset acababa
 * repitiendo tres veces el original de cámara (2665x4000). Es decir, la foto
 * principal de cada ficha y las 174 tarjetas del listado se servían sin tocar.
 *
 * Esta función normaliza ambas formas al par {bucket, key} que necesita el
 * image handler. La ruta estática ES la key del bucket, así que basta con
 * envolverla.
 */
function fuenteDe(url: string): { bucket: string; key: string } | null {
  const m = url.match(/^https?:\/\/[^/]+\/(.+)$/);
  if (!m) return null;
  const resto = m[1];

  try {
    const payload = JSON.parse(atob(resto));
    if (payload?.bucket && payload?.key) return { bucket: payload.bucket, key: payload.key };
  } catch {
    /* no es un payload base64: probamos la otra forma */
  }

  const ruta = decodeURIComponent(resto.split('?')[0]);
  if (ruta.startsWith('static/')) return { bucket: 'alterestate', key: ruta };

  return null;
}

/**
 * Identidad de una foto, independiente del CDN por el que llegue.
 * La misma imagen puede venir como URL cruda (portada) y como payload
 * (galería): comparar cadenas no las une, comparar keys sí.
 */
export function claveImagen(url: string | null | undefined): string {
  if (!url) return '';
  return fuenteDe(url)?.key ?? url;
}

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

  const fuente = fuenteDe(url);
  if (!fuente) return url;

  try {
    const next = {
      bucket: fuente.bucket,
      key: fuente.key,
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

    return `${CDN_TRANSFORMA}/${btoa(JSON.stringify(next))}`;
  } catch {
    // Cualquier cosa inesperada: preferimos servir el original a romper la página
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

/**
 * Rutas de zona que el sitio publica de verdad.
 *
 * Debe replicar exactamente las reglas de getStaticPaths en [tipo]/[sector]:
 * solo venta, sector siempre, ciudad solo si no coincide con el sector, y un
 * mínimo de dos propiedades. Cualquier página que enlace a una zona tiene que
 * consultarlo antes, o publica enlaces a un 404.
 */
let zonasCache: Set<string> | null = null;

export async function getZonasPublicadas(): Promise<Set<string>> {
  if (zonasCache) return zonasCache;

  const cuenta = new Map<string, number>();
  const sumar = (tipo: string, zona: string) => {
    const href = `/${slugify(tipo)}-en-venta/${slugify(zona)}/`;
    cuenta.set(href, (cuenta.get(href) ?? 0) + 1);
  };

  for (const p of await getAllProperties()) {
    const tipo = p.category?.name;
    if (!tipo || !isForSale(p)) continue;
    if (p.sector) sumar(tipo, p.sector);
    if (p.city && slugify(p.city) !== slugify(p.sector ?? '')) sumar(tipo, p.city);
  }

  zonasCache = new Set([...cuenta.entries()].filter(([, n]) => n >= 2).map(([href]) => href));
  return zonasCache;
}

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
