-- ======================================================================
-- Fase 5b · Enlaces de invitación
--
-- Para que el asesor se ponga su propia clave y esta no viaje por WhatsApp
-- ni la conozca el administrador.
--
-- Se guarda el HASH del token, no el token. Si alguien se llevara la tabla,
-- no se lleva invitaciones utilizables — el mismo criterio que con las claves.
-- Idempotente.
-- ======================================================================

alter table public.asesores add column if not exists invitacion_hash text;
alter table public.asesores add column if not exists invitacion_hasta timestamptz;

-- Buscar por el hash del token es la consulta de la pantalla de invitación.
create index if not exists asesores_invitacion_idx
  on public.asesores (invitacion_hash) where invitacion_hash is not null;
