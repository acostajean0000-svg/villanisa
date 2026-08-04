-- Fase 3 · Tiempo de respuesta y alertas
--
-- Pégalo en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin romper nada.

-- Cuándo y quién dijo "ya lo contacté".
--
-- `atendido_en` es el campo del que sale todo lo demás: la diferencia con
-- creado_en es el tiempo de respuesta, que es el dato que hoy nadie tiene y el
-- que decide si un lead se convierte en visita.
alter table public.leads add column if not exists atendido_en   timestamptz;
alter table public.leads add column if not exists atendido_por  text;

-- Cuándo se avisó de que llevaba demasiado tiempo sin atender.
--
-- Existe para no avisar dos veces del mismo lead. Sin esta columna, un aviso
-- cada cinco minutos sobre el mismo contacto consigue lo contrario de lo que
-- busca: que el equipo silencie el chat.
alter table public.leads add column if not exists alertado_en   timestamptz;

-- Los que el reloj está corriendo: sin atender y sin avisar todavía.
-- Índice parcial: solo indexa esos, que son un puñado en cualquier momento.
create index if not exists leads_sin_atender_idx
  on public.leads (creado_en)
  where atendido_en is null;

-- La tabla ya tenía permisos explícitos; las columnas nuevas los heredan.
-- Se repite el grant por si este archivo se corre en un proyecto donde
-- "Automatically expose new tables" estaba desactivado.
grant select, insert, update on public.leads to service_role;
