-- ======================================================================
-- Fase 6 · Gerentes y equipos
--
-- Hasta aquí todo el mundo era «asesor» o «administrador». La estructura real
-- tiene un nivel más: gerentes con asesores debajo.
--
-- Tres reglas que quedan grabadas aquí, no en el código:
--
--   1. El gerente NO entra en la rotación. Supervisa, mide y reasigna dentro
--      de su equipo; los turnos son de sus asesores.
--   2. El reparto es por equipo según la zona: el lead de una zona va al
--      equipo del gerente que cubre esa zona, y dentro del equipo al asesor
--      que lleva más tiempo sin recibir.
--   3. Si esa cascada no encuentra a nadie, el lead NO se pierde: baja a
--      cualquier asesor que cubra la zona, y en último término a cualquier
--      asesor activo. Un organigrama mal configurado no puede costar un
--      comprador.
--
-- Idempotente.
-- ======================================================================

-- ---------- Rol y jerarquía --------------------------------------------
alter table public.asesores add column if not exists rol text not null default 'asesor';
alter table public.asesores add column if not exists gerente_id uuid references public.asesores(id);

do $$ begin
  alter table public.asesores add constraint asesores_rol_valido
    check (rol in ('asesor', 'gerente', 'admin'));
exception when duplicate_object then null; end $$;

-- Quien ya estaba marcado como administrador conserva su rango: sin esto, al
-- correr este archivo el dueño del negocio pasaría a ser un asesor más.
update public.asesores set rol = 'admin' where admin = true and rol = 'asesor';

-- Nadie puede ser su propio jefe. Es un despiste de un clic en un desplegable,
-- y deja un ciclo que rompe cualquier consulta de equipo.
do $$ begin
  alter table public.asesores add constraint asesores_jefe_distinto
    check (gerente_id is null or gerente_id <> id);
exception when duplicate_object then null; end $$;

create index if not exists asesores_equipo_idx on public.asesores (gerente_id) where gerente_id is not null;
create index if not exists asesores_rol_idx on public.asesores (rol) where activo;

-- ---------- Reparto por equipo -----------------------------------------
/*
  Reemplaza la función de la Fase 4. Mantiene su contrato —devuelve la fila del
  asesor elegido, o null— y su atomicidad: se elige y se marca en la misma
  operación, con `for update skip locked`, porque dos formularios enviados en el
  mismo segundo no pueden caerle al mismo asesor.

  Lo nuevo es la cascada de tres intentos. El orden importa: primero la regla
  del negocio (el equipo de la zona), después la red de seguridad.
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
  /*
    Un cerrojo para todo el reparto, y hace falta.

    Sin él, dos leads simultáneos de la misma zona se encontraban las filas del
    equipo bloqueadas una por la otra; `skip locked` las saltaba y el segundo
    lead se iba por la red de seguridad a un asesor de FUERA del equipo. Lo vi
    en la prueba de concurrencia: seis leads de punta-cana repartieron 2-3 al
    equipo Este y 1 se escapó. Con el cerrojo, las llamadas se ponen en fila y
    cada una ve el estado real de la rotación.

    El precio es que los repartos se serializan. A este volumen —unos cuantos
    leads al día, y lo que se serializa es un UPDATE de una fila— no se nota;
    y a cambio la rotación es exacta y el equipo de la zona se respeta siempre.
  */
  perform pg_advisory_xact_lock(hashtext('villanisa:ruleta'));

  -- Intento 1 · asesores del equipo cuyo gerente cubre esta zona.
  if p_zona is not null then
    select a.* into eleg
      from public.asesores a
      join public.asesores g on g.id = a.gerente_id
     where a.rol = 'asesor'
       and a.activo and not a.ae_rechazado
       and (a.pausado_hasta is null or a.pausado_hasta <= now())
       and (a.hora_desde is null or a.hora_hasta is null
         or (a.hora_desde <= a.hora_hasta and h >= a.hora_desde and h <= a.hora_hasta)
         or (a.hora_desde >  a.hora_hasta and (h >= a.hora_desde or h <= a.hora_hasta)))
       and (cardinality(a.zonas) = 0 or p_zona = any(a.zonas))
       -- El gerente no tiene que estar disponible para que su equipo trabaje;
       -- basta con que no esté dado de baja.
       and g.activo and g.rol in ('gerente', 'admin')
       and p_zona = any(g.zonas)
     order by a.ultimo_en asc nulls first, a.orden asc, a.id asc
     limit 1
     for update of a skip locked;
  end if;

  -- Intento 2 · cualquier asesor que cubra la zona, con equipo o sin él.
  if eleg.id is null then
    select a.* into eleg
      from public.asesores a
     where a.rol = 'asesor'
       and a.activo and not a.ae_rechazado
       and (a.pausado_hasta is null or a.pausado_hasta <= now())
       and (a.hora_desde is null or a.hora_hasta is null
         or (a.hora_desde <= a.hora_hasta and h >= a.hora_desde and h <= a.hora_hasta)
         or (a.hora_desde >  a.hora_hasta and (h >= a.hora_desde or h <= a.hora_hasta)))
       and (p_zona is null or cardinality(a.zonas) = 0 or p_zona = any(a.zonas))
     order by a.ultimo_en asc nulls first, a.orden asc, a.id asc
     limit 1
     for update of a skip locked;
  end if;

  -- Intento 3 · último recurso: cualquier asesor activo, sin mirar zona ni hora.
  if eleg.id is null then
    select a.* into eleg
      from public.asesores a
     where a.rol = 'asesor'
       and a.activo and not a.ae_rechazado
       and (a.pausado_hasta is null or a.pausado_hasta <= now())
     order by a.ultimo_en asc nulls first, a.orden asc, a.id asc
     limit 1
     for update of a skip locked;
  end if;

  if eleg.id is null then return null; end if;

  update public.asesores
     set ultimo_en = now(), recibidos = recibidos + 1
   where id = eleg.id
   returning * into eleg;

  return eleg;
end;
$$;

revoke all on function public.siguiente_asesor(text) from public, anon, authenticated;
grant execute on function public.siguiente_asesor(text) to service_role;
