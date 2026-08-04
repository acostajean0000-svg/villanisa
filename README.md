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

En Vercel se configuran en *Project Settings → Environment Variables*.

Sin `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` el sitio sigue funcionando: los leads
van directos a AlterEstate como antes, y `/panel/leads` lo avisa en pantalla.
La tabla se crea con `supabase/01-leads.sql`.

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
