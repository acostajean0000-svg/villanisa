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
| `ENVIAR_A_ALTERESTATE` | `0` apaga la réplica de leads al CRM externo. Ausente o cualquier otro valor = encendido | Solo servidor |
| `SESION_SECRETO` | Firma las sesiones del equipo. Si falta se usa `PANEL_CLAVE` | Solo servidor · sensible |

En Vercel se configuran en *Project Settings → Environment Variables*.

Sin `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` el sitio sigue funcionando: los leads
van directos a AlterEstate como antes, y `/panel/leads` lo avisa en pantalla.
La tabla se crea con `supabase/01-leads.sql`, `supabase/02-atencion.sql`,
`supabase/03-ruleta.sql`, `supabase/04-crm.sql`, `supabase/05-invitaciones.sql`
y `supabase/06-equipos.sql`, en ese orden.

**El reparto de leads.** La ruleta propia (tabla `asesores`) decide a quién le
toca cada lead del sitio y se administra en `/panel/asesores`. Si la tabla está
vacía o la base falla, el reparto vuelve solo al round robin de AlterEstate:
instalar esto sin cargar asesores no cambia nada. El turno se elige y se marca
dentro de la base, en `siguiente_asesor()`, porque hacerlo en dos pasos desde el
sitio le daría el mismo asesor a dos leads simultáneos.

**El CRM propio (Fase 5).** Cada asesor entra en `/panel/entrar` con su correo
y su clave —que le asigna el administrador en `/panel/asesores`— y trabaja sus
leads en `/panel/mis-leads`: etapas, notas e historial. El administrador ve todo
en `/panel/tablero`. Un asesor solo puede tocar los leads que la ruleta le
asignó; el filtro va en la consulta a la base, no en la plantilla.

**Gerentes y equipos (Fase 6).** Tres roles: asesor, gerente y administración,
en la columna «Rol y equipo» de `/panel/asesores`. Un gerente **no entra en la
rotación**: ve el tablero de su equipo, mide, cambia etapas, anota y reasigna
entre sus propios asesores, pero no recibe leads ni toca los de otro equipo.

El reparto es **por equipo según la zona**: el lead de una zona va al equipo del
gerente que cubre esa zona, y dentro del equipo al asesor con el turno más
antiguo. Si ahí no hay nadie disponible, baja a cualquier asesor que cubra la
zona y, en último término, a cualquier asesor activo — un organigrama mal
configurado no puede costar un comprador.

Todo el reparto pasa por un cerrojo (`pg_advisory_xact_lock`). Sin él, dos leads
simultáneos de la misma zona se encontraban las filas del equipo bloqueadas una
por la otra, `skip locked` las saltaba y el segundo lead se escapaba a un asesor
de fuera del equipo. Se serializa el reparto, que a este volumen no se nota.

**Cómo estrena clave un asesor.** El administrador pulsa «Invitar» en
`/panel/asesores` y le manda el enlace que sale. El asesor lo abre, escribe la
clave que quiera y el enlace se quema; caduca a los 7 días y pedir uno nuevo
invalida el anterior. Así la clave no viaja por WhatsApp ni la conoce nadie más.
En la base solo se guarda el hash del token, igual que con las claves. El botón
«Ponerle una clave yo» sigue ahí para el asesor que no se maneje con enlaces.

La clave del panel (`PANEL_CLAVE`) sigue siendo la llave maestra: entra como
administrador aunque la tabla de asesores falle. Y el rango de administrador se
lee de la base en cada petición, no de la cookie: desactivar a alguien lo deja
fuera en su siguiente clic, no cuando venza su sesión.

**Apagar AlterEstate.** Con el CRM propio en marcha, `ENVIAR_A_ALTERESTATE=0`
deja de replicar los leads al CRM externo. El lead se sigue guardando en la base
propia y la ruleta lo sigue asignando; solo deja de salir del sistema. Está
encendido por defecto a propósito: una variable que desaparece por descuido no
puede significar «deja de mandar los leads al CRM».

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
