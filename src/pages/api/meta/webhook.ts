/**
 * Webhook de Meta Lead Ads — Fase 7.
 *
 * Meta avisa aquí cada vez que alguien llena un formulario de anuncio. El
 * aviso NO trae los datos: trae un identificador que hay que canjear contra la
 * Graph API con el token de la página.
 *
 * Tres reglas que gobiernan este archivo:
 *
 * 1. **Contestar 200 siempre que la firma sea válida**, aunque algo interno
 *    falle. Meta reintenta durante días y, si acumula fallos, desactiva la
 *    suscripción de la página entera. Un lead perdido es malo; quedarse sin
 *    recibir ninguno es peor. Lo que falle se queda escrito en el registro.
 *
 * 2. **Verificar la firma sobre el cuerpo crudo.** Si se reserializa el JSON,
 *    el hash cambia y no valida nunca.
 *
 * 3. **Solo se ingieren los formularios dados de alta y activos.** Con 166
 *    formularios en la cuenta, recibirlos todos llenaría la base de campañas
 *    viejas que alguien reactive sin querer.
 */
import type { APIRoute } from 'astro';
import { env } from '../../../lib/auth';
import {
  contarRecibido,
  firmaValida,
  formularioActivo,
  marcarFalloPagina,
  paginaPorPageId,
  traerLead,
} from '../../../lib/meta';
import { guardarLead, marcarCRM } from '../../../lib/leads';
import { siguienteAsesor } from '../../../lib/ruleta';

export const prerender = false;

/**
 * Verificación inicial de la suscripción.
 *
 * Meta llama una vez con un reto y espera que se le devuelva tal cual, en
 * texto plano. Es el saludo que activa el webhook.
 */
export const GET: APIRoute = async ({ url }) => {
  const modo = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const reto = url.searchParams.get('hub.challenge');
  const esperado = env('META_VERIFY_TOKEN');

  if (modo === 'subscribe' && esperado && token === esperado && reto) {
    return new Response(reto, {
      status: 200,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
    });
  }
  // 403 y nada más: no se explica qué falló, para no ayudar a adivinar el token.
  return new Response('no', { status: 403, headers: { 'Cache-Control': 'no-store' } });
};

interface Aviso {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: { leadgen_id?: string; page_id?: string; form_id?: string; ad_id?: string };
    }>;
  }>;
}

const ok = () => new Response('ok', { status: 200, headers: { 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  const crudo = await request.text();

  if (!(await firmaValida(crudo, request.headers.get('x-hub-signature-256')))) {
    // Aquí sí se rechaza: sin firma válida no es Meta, y cualquiera podría
    // inventarse contactos en la base del negocio.
    console.warn('[meta] firma inválida');
    return new Response('firma inválida', { status: 401 });
  }

  let aviso: Aviso;
  try {
    aviso = JSON.parse(crudo) as Aviso;
  } catch {
    return ok();
  }

  for (const entrada of aviso.entry ?? []) {
    for (const cambio of entrada.changes ?? []) {
      if (cambio.field !== 'leadgen') continue;
      try {
        await procesar(cambio.value ?? {}, entrada.id);
      } catch (err) {
        // Un lead que falla no puede tumbar los demás del mismo aviso.
        console.error('[meta] error procesando:', (err as Error).message);
      }
    }
  }

  return ok();
};

async function procesar(
  v: { leadgen_id?: string; page_id?: string; form_id?: string; ad_id?: string },
  entryId?: string
): Promise<void> {
  const leadgenId = v.leadgen_id;
  const pageId = v.page_id ?? entryId;
  if (!leadgenId || !pageId) return;

  const pagina = await paginaPorPageId(pageId);
  if (!pagina) {
    console.warn(`[meta] aviso de una página no conectada: ${pageId}`);
    return;
  }

  const { lead, error } = await traerLead(leadgenId, pagina.token);
  if (!lead) {
    // Casi siempre es el token: alguien cambió su clave de Facebook o revocó
    // permisos. Se marca para que el panel lo enseñe en rojo en vez de que los
    // leads dejen de entrar en silencio.
    await marcarFalloPagina(pageId, error ?? 'no se pudo leer el lead');
    console.error(`[meta] no se pudo traer ${leadgenId}: ${error}`);
    return;
  }

  const formId = lead.form_id || v.form_id || '';
  const form = formId ? await formularioActivo(formId) : null;
  if (!form) {
    // No es un error: es un formulario que nadie dio de alta, o que está
    // apagado a propósito.
    console.info(`[meta] formulario ignorado: ${formId}`);
    return;
  }

  // La zona del formulario entra en la ruleta igual que la de una ficha del
  // sitio, así que un lead de una campaña de Punta Cana le toca al equipo de
  // Punta Cana sin ninguna regla nueva.
  const turno = await siguienteAsesor(form.zona || null);

  const id = await guardarLead({
    nombre: lead.nombre || 'Sin nombre',
    email: lead.email,
    telefono: lead.telefono,
    mensaje: lead.mensaje,
    pagina: `Meta · ${form.nombre}`,
    formulario: 'meta-lead-ads',
    utm_source: 'facebook',
    utm_medium: 'paid',
    utm_campaign: form.campana || form.nombre,
    asesor_id: turno?.id ?? null,
    asignado_a: turno ? `ruleta: ${turno.nombre}` : undefined,
    meta_leadgen_id: lead.leadgen_id,
    meta_form_id: formId,
    meta_ad_id: lead.ad_id ?? undefined,
  });

  if (!id) {
    // El caso normal aquí es el reintento de Meta sobre un lead ya guardado:
    // la restricción única de `meta_leadgen_id` lo rechaza y eso es un acierto,
    // no un fallo. Por eso no se marca la página como rota.
    console.info(`[meta] no se guardó ${leadgenId} (probable duplicado)`);
    return;
  }

  // Estos leads NO se replican a AlterEstate: es una decisión del negocio, el
  // formulario que se conecta aquí se desconecta allá para que el contacto no
  // entre dos veces.
  await marcarCRM(id, 'apagado', 'Lead de Meta: vive solo en el sistema propio');
  await contarRecibido(formId, form.recibidos);
}
