# Villanisa — sitio web

Sitio estático construido con **Astro 7** + **Tailwind 4**, desplegado en Vercel.
El inventario se lee en tiempo de build desde la API de AlterEstate.

## Puesta en marcha

```bash
npm install
cp .env.example .env   # completar variables
npm run dev            # http://localhost:4321
npm run build          # genera dist/
```

## Variables de entorno

| Variable | Para qué | Dónde |
|---|---|---|
| `ALTERESTATE_DOMAIN` | Identifica la empresa ante la API (lectura de propiedades) | Build |
| `ALTERESTATE_API_KEY` | Envío de leads al CRM. **Nunca exponer al cliente** | Solo servidor · sensible |
| `ALTERESTATE_ROUND_ROBIN_UID` | Regla de reparto por turnos para los leads sin asesor | Solo servidor |
| `ALTERESTATE_VIA_ID` | Vía propia del sitio, para separarlo de villanisainmobiliaria.com | Solo servidor |
| `PANEL_USUARIO` / `PANEL_CLAVE` | Puerta de `/panel` y de la API de contenido | Solo servidor · la clave, sensible |
| `BLOB_READ_WRITE_TOKEN` | Almacén de los textos propios de las fichas | Solo servidor · sensible |
| `DEPLOY_HOOK_URL` | Republica el sitio al guardar textos en el panel | Solo servidor · sensible |
| `SUPABASE_URL` | Almacén propio de leads (Fase 2) | Solo servidor |
| `SUPABASE_SERVICE_KEY` | Escritura y lectura de ese almacén. **Salta la seguridad de la tabla: jamás en el navegador** | Solo servidor · sensible |
| `ALERTA_MINUTOS` | Minutos sin atender antes de avisar (por defecto 10) | Solo servidor |
| `CRON_SECRET` | Autoriza al reloj de GitHub Actions a llamar a `/api/alertas` | Solo servidor · sensible |
| `ALERTA_TELEFONOS` | Números que reciben el aviso, separados por coma, con código de país | Solo servidor |
| `WHATSAPP_TOKEN` | Token permanente de la Cloud API de Meta | Solo servidor · sensible |
| `WHATSAPP_PHONE_ID` | Phone number ID del número emisor | Solo servidor |
| `WHATSAPP_PLANTILLA` | Nombre de la plantilla aprobada (4 parámetros, en este orden: nombre, teléfono, propiedad, minutos) | Solo servidor |
| `WHATSAPP_IDIOMA` | Código de idioma de la plantilla (por defecto `es`) | Solo servidor |

En Vercel se configuran en *Project Settings → Environment Variables*.

Sin `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` el sitio sigue funcionando: los leads
van directos a AlterEstate como antes, y `/panel/leads` lo avisa en pantalla.
La tabla se crea con `supabase/01-leads.sql` y `supabase/02-atencion.sql`.

Sin las variables de WhatsApp, la Fase 3 sigue siendo útil: el botón «Ya lo
contacté», el tiempo de respuesta y los pendientes marcados funcionan igual;
lo único que no sale es el aviso automático.

**El reloj no está en Vercel.** El proyecto corre en el plan Hobby, donde los
cron jobs solo pueden ejecutarse una vez al día — una expresión más frecuente
hace fallar el despliegue. Vive en `.github/workflows/alertas.yml` y llama a
`/api/alertas` cada 10 minutos con `CRON_SECRET` guardado como secreto del
repositorio en GitHub.

## Estructura

```
src/
  lib/alterestate.ts        Cliente de la API: paginación, reintentos, caché, normalización
  layouts/Base.astro        SEO: canonical, Open Graph, JSON-LD, accesibilidad
  components/               Header, Footer, PropertyCard, LeadForm
  pages/
    index.astro             Home
    propiedades/            Listado con filtros + ficha de propiedad
    comprar/[...ruta]       Landings por sector, generadas desde el inventario
    agentes | nosotros | contacto
    api/lead.ts             Endpoint servidor → CRM (protege la API key)
```

## Reconstrucción automática

El inventario cambia a diario. En Vercel: *Settings → Cron Jobs* o un
Deploy Hook llamado por un cron externo, 2–4 veces al día.

## Pendiente

- Blog + panel de edición para el equipo no técnico
- Sección de proyectos en planos (endpoints `/projects/buildings/` y `/properties/public/units/`)
- Imágenes Open Graph generadas por propiedad
- Versión en inglés con hreflang
- Redirecciones 301 desde las URLs del WordPress actual
