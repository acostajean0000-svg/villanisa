import type { APIRoute } from 'astro';
import { RUTA_CONTENIDO, type Overrides } from '../../lib/contenido';
import { env, verificarBasic, RETO } from '../../lib/auth';

export const prerender = false;

/** Una sola implementación de la puerta, compartida con /panel. */
const autorizado = (request: Request): boolean =>
  verificarBasic(request.headers.get('authorization')).ok;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const noAutorizado = () => new Response('No autorizado', { status: 401, headers: RETO });

/**
 * Lee el almacén distinguiendo "todavía no existe" de "no se pudo leer".
 *
 * El SDK devuelve null cuando el blob no existe; el catch solo salta ante
 * fallos reales (límite de peticiones, servicio caído, token caducado). Antes
 * los dos casos devolvían {} y el POST guardaba encima: **un fallo transitorio
 * borraba todas las descripciones escritas hasta ese momento**, devolvía
 * ok:true y republicaba el sitio sin ellas. No hay copia de seguridad de ese
 * fichero, así que la pérdida sería definitiva.
 */
async function leer(token: string): Promise<{ datos: Overrides; fiable: boolean }> {
  const { get } = await import('@vercel/blob');
  try {
    const res = await get(RUTA_CONTENIDO, { access: 'private', token, useCache: false });
    if (!res?.stream) return { datos: {}, fiable: true }; // aún no existe: primera vez
    return { datos: (await new Response(res.stream).json()) as Overrides, fiable: true };
  } catch (err) {
    console.error('[contenido] no se pudo leer el almacén:', (err as Error).message);
    return { datos: {}, fiable: false };
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
    const { datos: actual, fiable } = await leer(token);

    // Si no pudimos leer, NO escribimos: guardar encima destruiría lo anterior.
    if (!fiable) {
      return json(
        { ok: false, error: 'No se pudo leer el almacén. No se guardó nada; inténtalo de nuevo.' },
        503
      );
    }

    const ahora = new Date().toISOString();
    let escritos = 0;

    for (const [uid, v] of Object.entries(cambios)) {
      // Un uid con forma rara (o "__proto__") no se guarda ni cuenta.
      if (!/^[A-Za-z0-9_-]{4,40}$/.test(uid)) continue;

      const descripcion = (v.descripcion ?? '').trim().slice(0, 8000);
      const titulo = (v.titulo ?? '').trim().slice(0, 200);
      const previo = actual[uid] ?? {};

      if (!descripcion && !titulo && 'descripcion' in v && 'titulo' in v) {
        // Vaciar los dos campos equivale a volver a lo que diga el CRM
        delete actual[uid];
        escritos++;
        continue;
      }

      /**
       * Fusión por campo, no reemplazo. El panel solo envía `descripcion`, así
       * que el reemplazo total borraba el `titulo` propio en cada guardado —
       * la función de título quedaba muerta sin que nadie lo notara.
       */
      const siguiente = {
        ...previo,
        ...(descripcion ? { descripcion } : {}),
        ...(titulo ? { titulo } : {}),
        actualizado: ahora,
      };
      if (!siguiente.descripcion && !siguiente.titulo) {
        delete actual[uid];
      } else {
        actual[uid] = siguiente;
      }
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
