-- Almacén propio de leads — Fase 2
--
-- Pégalo entero en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin romper nada (todo lleva IF NOT EXISTS).

create extension if not exists pgcrypto;

create table if not exists public.leads (
  id                uuid primary key default gen_random_uuid(),
  creado_en         timestamptz not null default now(),

  -- Contacto
  nombre            text not null,
  email             text not null,
  telefono          text not null,
  mensaje           text,

  -- Qué estaba mirando
  propiedad_uid     text,
  propiedad_nombre  text,
  pagina            text,
  formulario        text,

  -- A quién le tocó
  asesor_ref        text,
  asignado_a        text,

  -- De dónde vino
  referente         text,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  utm_term          text,

  -- Qué pasó al replicarlo a AlterEstate.
  -- Este campo es el que convierte la tabla en una herramienta y no en un
  -- archivo muerto: los que no queden en 'enviado' son los que el equipo
  -- comercial NO está viendo y hay que meter a mano.
  crm_estado        text not null default 'pendiente'
                      check (crm_estado in ('pendiente', 'enviado', 'rechazado', 'sin_clave')),
  crm_detalle       text,
  crm_enviado_en    timestamptz
);

-- El panel siempre pide los últimos primero.
create index if not exists leads_creado_en_idx on public.leads (creado_en desc);

-- Índice parcial: solo indexa los problemáticos, que son pocos.
create index if not exists leads_pendientes_idx
  on public.leads (creado_en desc)
  where crm_estado <> 'enviado';

-- Seguridad a nivel de fila, ACTIVADA y sin ninguna política.
--
-- Esto no es un detalle opcional. La clave pública de Supabase (`anon`) va
-- pensada para vivir en el navegador, así que hay que asumir que cualquiera
-- puede tenerla. Con RLS activado y cero políticas, esa clave no puede leer ni
-- escribir una sola fila: la lista completa de contactos del negocio queda
-- fuera del alcance de quien la consiga.
--
-- La clave de servicio (`service_role`) salta RLS por diseño, y por eso vive
-- SOLO como variable de entorno del servidor en Vercel, marcada como sensible,
-- y nunca se envía al navegador. Ver src/pages/panel/leads.astro: esa página se
-- renderiza en el servidor precisamente para no tener que exponerla.
alter table public.leads enable row level security;

-- Permisos explícitos, no heredados.
--
-- Al crear el proyecto, Supabase ofrece "Automatically expose new tables" y
-- recomienda desactivarlo. Con estas tres líneas la tabla funciona con la
-- casilla puesta o quitada, así que se puede seguir su recomendación sin que
-- nada se rompa.
--
-- Y son dos cierres distintos, no uno repetido: RLS filtra QUÉ FILAS ve cada
-- rol; el REVOKE quita el permiso de tocar la tabla siquiera. Si algún día
-- alguien añade una política permisiva sin pensarlo —el error más común en
-- Supabase— el REVOKE sigue sosteniendo la puerta.
grant usage on schema public to service_role;
grant select, insert, update on public.leads to service_role;
revoke all on public.leads from anon, authenticated;
