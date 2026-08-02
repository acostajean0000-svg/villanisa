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
| `ALTERESTATE_API_KEY` | Envío de leads al CRM. **Nunca exponer al cliente** | Solo servidor |

En Vercel se configuran en *Project Settings → Environment Variables*.

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
