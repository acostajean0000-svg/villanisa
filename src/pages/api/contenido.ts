import type { APIRoute } from 'astro';
import { RUTA_CONTENIDO, type Overrides } from '../../lib/contenido';

export const prerender = false;

const env = (clave: string): string | undefined => {
  const enEjecucion =
    typeof process !== 'undefined' && process.env ? process.env[clave] : undefined;
  return enEjecucion ?? (import.meta.env as Record<string, string | undefined>)[clave];
};

/** Mismas credenciales que el panel: una sola puerta para lo interno. */
function autorizado(request: Request): boolean {
  const CLAVE = env('PANEL_CLAVE');
  if (!CLAVE) return false;
  const USUARIO = env('PANEL_USUARIO') || 'villanisa';
  const [tipo, cred] = (request.headers.get('authorization') ?? '').split(' ');
  if (tipo?.toLowerCase() !== 'basic' || !cred) return false;
  try {
    const [u, c] = atob(cred).split(':');
    return u === USUARIO && c === CLAVE;
  } catch {
    return false;
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const noAutorizado = () =>
  new Response('No autorizado', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Panel Villanisa"' },
  });

async function leer(token: string): Promise<Overrides> {
  const { get } = await import('@vercel/blob');
  try {
    const res = await get(RUTA_CONTENIDO, { access: 'private', token, useCache: false });
    return res?.stream ? ((await new Response(res.stream).json()) as Overrides) : {};
  } catch {
    // Todavía no existe el archivo: primera vez que se guarda
    return {};
  }
}

export const GET: APIRoute = async ({ request }) => {
  if (!autorizado(request)) return noAutorizado();
  const token = env('BLOB_READ_WRITE_TOKEN');
  if (!token) return json({ ok: false, error: 'Falta el almacén (BLOB_READ_WRITE_TOKEN)' }, 503);
  try {
    return json({ ok: true, overrides: await leer(token) });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  if (!autorizado(request)) return noAutorizado();

  const token = env('BLOB_READ_WRITE_TOKEN');
  if (!token) return json({ ok: false, error: 'Falta el almacén (BLOB_READ_WRITE_TOKEN)' }, 503);

  let cambios: Record<string, { descripcion?: string; titulo?: string }>;
  try {
    cambios = (await request.json()).cambios;
    if (!cambios || typeof cambios !== 'object') throw new Error('sin cambios');
  } catch {
    return json({ ok: false, error: 'Cuerpo inválido' }, 400);
  }

  try {
    const actual = await leer(token);
    const ahora = new Date().toISOString();
    let escritos = 0;

    for (const [uid, v] of Object.entries(cambios)) {
      const descripcion = (v.descripcion ?? '').trim();
      const titulo = (v.titulo ?? '').trim();
      if (!descripcion && !titulo) {
        // Vaciar los dos campos equivale a volver a lo que diga el CRM
        delete actual[uid];
        escritos++;
        continue;
      }
      actual[uid] = {
        ...(descripcion ? { descripcion } : {}),
        ...(titulo ? { titulo } : {}),
        actualizado: ahora,
      };
      escritos++;
    }

    const { put } = await import('@vercel/blob');
    await put(RUTA_CONTENIDO, JSON.stringify(actual, null, 1), {
      access: 'private',
      token,
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
    });

    // Regenera el sitio para que los textos nuevos salgan publicados
    let despliegue = 'no configurado';
    const hook = env('DEPLOY_HOOK_URL');
    if (hook) {
      try {
        const r = await fetch(hook, { method: 'POST' });
        despliegue = r.ok ? 'lanzado' : `error ${r.status}`;
      } catch {
        despliegue = 'no se pudo lanzar';
      }
    }

    return json({ ok: true, escritos, total: Object.keys(actual).length, despliegue });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
};
