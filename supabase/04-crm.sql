-- ======================================================================
-- Fase 5 · El CRM propio
--
-- Hasta aquí el sitio guardaba el lead y lo repartía, pero el trabajo diario
-- —llamar, anotar, mover de etapa— seguía viviendo en AlterEstate. Esto le da
-- a ese trabajo un lugar propio: etapas, notas e historial, y una clave por
-- asesor para que cada quien vea solo lo suyo.
--
-- Idempotente: se puede correr dos veces sin romper nada.
-- ======================================================================

-- ---------- Etapas del lead --------------------------------------------
-- La etapa se guarda como texto con restricción, no como enum de Postgres:
-- añadir un valor a un enum exige un ALTER TYPE que no se puede revertir
-- dentro de una transacción. Con CHECK, cambiar el catálogo es una línea.
alter table public.leads add column if not exists etapa text not null default 'nuevo';
alter table public.leads add column if not exists etapa_en timestamptz not null default now();
alter table public.leads add column if not exists etapa_por text;
alter table public.leads add column if not exists motivo_perdida text;

do $$ begin
  alter table public.leads add constraint leads_etapa_valida
    check (etapa in ('nuevo','contactado','visita','negociacion','cerrado','perdido'));
exception when duplicate_object then null; end $$;

create index if not exists leads_etapa_idx on public.leads (etapa, creado_en desc);
create index if not exists leads_asesor_idx on public.leads (asesor_id, creado_en desc);

-- ---------- Estado 'apagado' para el CRM externo ------------------------
-- Cuando la replicación a AlterEstate se apaga, el lead no está "rechazado"
-- ni le falta una clave: simplemente ya no se replica. Sin este valor habría
-- que reutilizar 'sin_clave', y el panel diría que falta configurar algo que
-- en realidad se apagó a propósito.
alter table public.leads drop constraint if exists leads_crm_estado_check;
do $$ begin
  alter table public.leads add constraint leads_crm_estado_check
    check (crm_estado in ('pendiente','enviado','rechazado','sin_clave','apagado'));
exception when duplicate_object then null; end $$;

-- ---------- Historial de etapas ----------------------------------------
-- Sin esto, "¿cuánto tardamos de contactado a visita?" no se puede contestar:
-- la columna `etapa` solo sabe dónde está el lead hoy, no cómo llegó.
create table if not exists public.lead_etapas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  de text,
  a text not null,
  por text,
  creado_en timestamptz not null default now()
);
create index if not exists lead_etapas_lead_idx on public.lead_etapas (lead_id, creado_en);

-- ---------- Notas -------------------------------------------------------
create table if not exists public.lead_notas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  autor text not null,
  autor_id uuid references public.asesores(id),
  texto text not null,
  creado_en timestamptz not null default now()
);
create index if not exists lead_notas_lead_idx on public.lead_notas (lead_id, creado_en desc);

-- ---------- Acceso del asesor ------------------------------------------
-- `correo` es la identidad para entrar al panel, separada de `ae_ref`, que es
-- la identidad en AlterEstate. Suelen ser el mismo correo, pero no tienen por
-- qué serlo, y atarlos obligaría a que un asesor sin cuenta en el CRM tampoco
-- pudiera entrar aquí — justo al revés de lo que queremos.
alter table public.asesores add column if not exists correo text;
alter table public.asesores add column if not exists clave_hash text;
alter table public.asesores add column if not exists admin boolean not null default false;
alter table public.asesores add column if not exists ultimo_acceso timestamptz;

-- Único pero tolerante al nulo: varios asesores pueden no tener acceso aún.
create unique index if not exists asesores_correo_unico
  on public.asesores (lower(correo)) where correo is not null;

-- ---------- Permisos ----------------------------------------------------
-- Mismo criterio que el resto del esquema: solo el rol de servicio entra, y
-- entra desde el servidor. Ninguna de estas tablas se toca desde el navegador.
alter table public.lead_etapas enable row level security;
alter table public.lead_notas  enable row level security;

grant select, insert, update, delete on public.lead_etapas to service_role;
grant select, insert, update, delete on public.lead_notas  to service_role;
revoke all on public.lead_etapas from anon, authenticated;
revoke all on public.lead_notas  from anon, authenticated;
