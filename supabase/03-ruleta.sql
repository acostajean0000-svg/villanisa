-- Ruleta propia de asesores — Fase 4
--
-- Pégalo en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin romper nada.
--
-- Qué cambia respecto al round robin de AlterEstate: el reparto lo decide
-- Villanisa, con reglas que ellos no tienen (zona, horario, vacaciones) y,
-- sobre todo, con acceso al dato de atención — que vive en esta misma base y
-- permite quitarle un lead a quien no contestó.

create extension if not exists pgcrypto;

create table if not exists public.asesores (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,

  -- Correo o UID del asesor en AlterEstate. Es lo que se manda como `related`
  -- para que el lead aparezca a su nombre allá. Sin esto, el lead entra pero
  -- sin dueño en el CRM.
  ae_ref         text,
  telefono       text,

  -- Reglas de reparto
  activo         boolean not null default true,
  orden          int     not null default 100,
  zonas          text[]  not null default '{}',  -- slugs de ciudad; vacío = todas
  hora_desde     int,                            -- 0..23; null = a cualquier hora
  hora_hasta     int,
  pausado_hasta  timestamptz,                    -- vacaciones

  -- Si AlterEstate rechaza su referencia (se fue de la empresa, correo viejo),
  -- se marca y deja de tocarle turno hasta que alguien lo corrija. Antes ese
  -- fallo tumbaba el lead entero.
  ae_rechazado   boolean not null default false,
  ae_detalle     text,

  -- Estado de la rotación
  recibidos      int not null default 0,
  ultimo_en      timestamptz,

  creado_en      timestamptz not null default now()
);

create index if not exists asesores_turno_idx
  on public.asesores (ultimo_en asc nulls first, orden asc)
  where activo;

-- A quién le tocó, y cuántas veces hubo que reasignar por silencio.
alter table public.leads add column if not exists asesor_id      uuid references public.asesores(id);
alter table public.leads add column if not exists reasignaciones int not null default 0;

/*
  Reparto atómico.

  Por qué una función en la base y no en el código del sitio: elegir y marcar
  el turno tienen que ser UNA operación. Si dos visitantes envían el formulario
  en el mismo segundo y el sitio lee "le toca a Ana" dos veces antes de
  escribir, Ana recibe los dos y el siguiente ninguno. Aquí el `for update
  skip locked` hace que el segundo lead pase al siguiente asesor sin esperar.

  El criterio es "a quien le tocó hace más tiempo" (ultimo_en más antiguo),
  no un puntero fijo. Con todos disponibles produce exactamente la misma
  vuelta 1→2→3→1; la diferencia aparece cuando alguien se pausa o se añade:
  un puntero se desordena, esto se acomoda solo. `orden` desempata al arrancar,
  cuando nadie ha recibido nada todavía.
*/
create or replace function public.siguiente_asesor(p_zona text default null)
returns public.asesores
language plpgsql
security definer
set search_path = public
as $$
declare
  eleg public.asesores;
  h int := extract(hour from (now() at time zone 'America/Santo_Domingo'))::int;
begin
  -- 1) Quien cubra la zona y esté en horario.
  --    Un asesor sin zonas atiende todo; uno sin horario, a cualquier hora.
  select * into eleg
    from public.asesores a
   where a.activo
     and not a.ae_rechazado
     and (a.pausado_hasta is null or a.pausado_hasta <= now())
     and (
       a.hora_desde is null or a.hora_hasta is null
       or (a.hora_desde <= a.hora_hasta and h >= a.hora_desde and h <= a.hora_hasta)
       -- turno que cruza la medianoche (ej. 20 a 6)
       or (a.hora_desde >  a.hora_hasta and (h >= a.hora_desde or h <= a.hora_hasta))
     )
     and (p_zona is null or cardinality(a.zonas) = 0 or p_zona = any(a.zonas))
   order by a.ultimo_en asc nulls first, a.orden asc, a.id asc
   limit 1
   for update skip locked;

  -- 2) Último recurso: cualquiera activo, ignorando zona y horario.
  --    Un lead sin dueño se pierde; uno en manos imperfectas se recupera.
  if eleg.id is null then
    select * into eleg
      from public.asesores a
     where a.activo
       and not a.ae_rechazado
       and (a.pausado_hasta is null or a.pausado_hasta <= now())
     order by a.ultimo_en asc nulls first, a.orden asc, a.id asc
     limit 1
     for update skip locked;
  end if;

  if eleg.id is null then
    return null;  -- no hay nadie: quien llame decide (cae en AlterEstate)
  end if;

  update public.asesores
     set ultimo_en = now(),
         recibidos = recibidos + 1
   where id = eleg.id
  returning * into eleg;

  return eleg;
end;
$$;

-- Misma postura que las otras tablas: RLS activado, cero políticas, y los
-- permisos concedidos de forma explícita solo a la clave de servidor.
alter table public.asesores enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.asesores to service_role;
revoke all on public.asesores from anon, authenticated;
revoke all on function public.siguiente_asesor(text) from public, anon, authenticated;
grant execute on function public.siguiente_asesor(text) to service_role;
