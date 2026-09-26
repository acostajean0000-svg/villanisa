/**
 * La vuelta de Facebook — Fase 7.
 *
 * Canjea el código por un token, alarga ese token, guarda cada página con el
 * suyo, suscribe la página al webhook de leads y trae la lista de formularios
 * para que el administrador elija cuáles quiere.
 *
 * La suscripción es el paso que más se olvida: sin ella la conexión se ve
 * perfecta en pantalla y Meta no avisa de nada nunca.
 */
import type { APIRoute } from 'astro';
import { identificar } from '../../../lib/guardia';
import { estadoValido, COOKIE_ESTADO } from './conectar';
import {
  formulariosDePagina,
  guardarPagina,
  paginaPorPageId,
  paginasDelUsuario,
  sincronizarFormularios,
  suscribirPagina,
  tokenDeUsuario,
} from '../../../lib/meta';

export const prerender = false;

const volver = (cola: string) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: `/panel/meta/${cola}`,
      'Cache-Control': 'no-store',
      // El testigo del viaje ya cumplió: se borra.
      'Set-Cookie': `${COOKIE_ESTADO}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });

export const GET: APIRoute = async ({ request, url }) => {
  const quien = await identificar(request);
  if (quien.tipo !== 'admin') return volver('?e=permiso');

  // Si el administrador canceló en la pantalla de Facebook.
  if (url.searchParams.get('error')) return volver('?e=cancelado');

  if (!(await estadoValido(url.searchParams.get('state'), request.headers.get('cookie')))) {
    return volver('?e=estado');
  }

  const codigo = url.searchParams.get('code');
  if (!codigo) return volver('?e=codigo');

  try {
    const token = await tokenDeUsuario(codigo, url.origin);
    if (!token) return volver('?e=token');

    const paginas = await paginasDelUsuario(token);
    if (!paginas.length) return volver('?e=sin-paginas');

    let nuevas = 0;
    const avisos: string[] = [];

    for (const p of paginas) {
      await guardarPagina({ ...p, conectada_por: quien.nombre });

      // Sin esto no llega ningún aviso, así que un fallo aquí se cuenta.
      const fallo = await suscribirPagina(p.page_id, p.token);
      if (fallo) avisos.push(`${p.nombre}: ${fallo}`);

      const guardada = await paginaPorPageId(p.page_id);
      if (!guardada) continue;
      nuevas += await sincronizarFormularios(
        guardada.id,
        await formulariosDePagina(p.page_id, p.token)
      );
    }

    const cola = `?ok=1&paginas=${paginas.length}&formularios=${nuevas}` +
      (avisos.length ? `&aviso=${encodeURIComponent(avisos.join(' · ').slice(0, 200))}` : '');
    return volver(cola);
  } catch (err) {
    console.error('[meta] callback:', (err as Error).message);
    return volver('?e=servidor');
  }
};
