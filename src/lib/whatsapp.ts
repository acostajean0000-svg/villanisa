/**
 * Avisos por WhatsApp — Fase 3.
 *
 * Usa la Cloud API oficial de Meta. No hay atajo aquí: mandar mensajes
 * automáticos por WhatsApp exige cuenta de empresa verificada, un número
 * dedicado y una plantilla aprobada. Cualquier librería que prometa saltarse
 * eso funciona con WhatsApp Web y acaba con el número bloqueado — que en este
 * caso sería el número por el que la inmobiliaria atiende a sus clientes.
 *
 * Coste: desde julio de 2025 Meta cobra por mensaje, no por conversación. Las
 * plantillas de categoría "utility" —que es lo que es un aviso interno— son
 * gratis dentro de la ventana de 24 horas y cuestan una fracción de centavo
 * fuera de ella. Con el volumen de Villanisa esto son centavos al mes: la
 * barrera real es el papeleo de verificación, no el precio.
 *
 * Mientras no esté aprobada la cuenta, esto no envía nada y lo dice. El
 * circuito de alertas sigue funcionando y los pendientes salen marcados en el
 * panel, así que la Fase 3 es útil desde el primer día sin esperar a Meta.
 */
import { env } from './auth';

export interface ResultadoEnvio {
  enviados: number;
  fallidos: number;
  configurado: boolean;
  detalle: string;
}

const API = 'https://graph.facebook.com/v21.0';

/** Números a los que va el aviso, en formato internacional sin '+' ni espacios. */
function destinatarios(): string[] {
  return (env('ALERTA_TELEFONOS') ?? '')
    .split(',')
    .map((n) => n.replace(/\D/g, ''))
    .filter((n) => n.length >= 10 && n.length <= 15);
}

export function whatsappConfigurado(): boolean {
  return Boolean(
    env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_ID') && env('WHATSAPP_PLANTILLA') && destinatarios().length
  );
}

/**
 * Envía la plantilla de aviso a cada destinatario.
 *
 * Los parámetros van en el orden en que aparecen en la plantilla aprobada:
 *   1) nombre del contacto
 *   2) teléfono
 *   3) qué estaba mirando
 *   4) minutos que lleva esperando
 *
 * Si cambias el orden en Meta, hay que cambiarlo aquí: WhatsApp los sustituye
 * por posición, no por nombre, así que un desajuste no da error — manda el
 * teléfono donde debería ir el nombre.
 */
export async function avisarLeadSinAtender(datos: {
  nombre: string;
  telefono: string;
  propiedad: string;
  minutos: number;
}): Promise<ResultadoEnvio> {
  if (!whatsappConfigurado()) {
    return {
      enviados: 0,
      fallidos: 0,
      configurado: false,
      detalle: 'WhatsApp todavía no está conectado (faltan WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_PLANTILLA o ALERTA_TELEFONOS).',
    };
  }

  const token = env('WHATSAPP_TOKEN')!;
  const phoneId = env('WHATSAPP_PHONE_ID')!;
  const plantilla = env('WHATSAPP_PLANTILLA')!;
  const idioma = env('WHATSAPP_IDIOMA') || 'es';

  // WhatsApp rechaza el mensaje entero si un parámetro trae saltos de línea o
  // se pasa de largo. Se limpia antes de enviar, no después de que falle.
  const limpiar = (t: string, max = 60) =>
    (t || '—').replace(/\s+/g, ' ').trim().slice(0, max) || '—';

  const parametros = [
    limpiar(datos.nombre),
    limpiar(datos.telefono, 25),
    limpiar(datos.propiedad, 80),
    String(datos.minutos),
  ].map((text) => ({ type: 'text', text }));

  let enviados = 0;
  let fallidos = 0;
  const errores: string[] = [];

  for (const numero of destinatarios()) {
    try {
      const res = await fetch(`${API}/${phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: numero,
          type: 'template',
          template: {
            name: plantilla,
            language: { code: idioma },
            components: [{ type: 'body', parameters: parametros }],
          },
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        enviados++;
      } else {
        fallidos++;
        errores.push(`${numero}: ${res.status} ${(await res.text()).slice(0, 160)}`);
      }
    } catch (err) {
      fallidos++;
      errores.push(`${numero}: ${(err as Error).message}`);
    }
  }

  return {
    enviados,
    fallidos,
    configurado: true,
    detalle: errores.length ? errores.join(' | ') : `Enviado a ${enviados} número(s).`,
  };
}
