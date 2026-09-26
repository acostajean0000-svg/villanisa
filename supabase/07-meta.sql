-- ======================================================================
-- Fase 7 · Integración propia con Meta Lead Ads
--
-- Hoy los leads de las campañas de Facebook entran directo a AlterEstate y el
-- sistema propio no los ve: ni reparto, ni etapas, ni tiempo de respuesta, ni
-- costo por lead. Aquí empieza a verlos.
--
-- Dos tablas y tres columnas. Lo importante está en los comentarios de cada
-- una, porque son decisiones, no campos.
--
-- Idempotente.
-- ======================================================================

-- ---------- Páginas de Facebook conectadas ------------------------------
/*
  El token de página es la llave para leer los leads de esa página. Vive aquí
  y no en una variable de entorno porque hay una por página y se renueva sola
  cuando el administrador vuelve a conectar.

  Queda en la base en claro, como la clave del almacén: la tabla no la puede
  leer nadie salvo el rol de servicio, y solo desde el servidor. Si algún día
  hiciera falta cifrarlo, el sitio donde hacerlo es este comentario.
*/
create table if not exists public.meta_paginas (
  id            uuid primary key default gen_random_uuid(),
  page_id       text not null unique,
  nombre        text not null,
  token         text not null,
  -- Quién la conectó y cuándo: si mañana deja de entrar nada, lo primero que
  -- se pregunta es de quién dependía ese permiso.
  conectada_por text,
  conectada_en  timestamptz not null default now(),
  -- Meta invalida el token si esa persona cambia la clave o revoca permisos.
  -- Se marca aquí para poder avisarlo en el panel antes de que alguien
  -- descubra por su cuenta que lleva tres días sin recibir leads.
  fallo_en      timestamptz,
  fallo_detalle text
);

-- ---------- Formularios ------------------------------------------------
/*
  Una fila por formulario que queremos ingerir. Los que no estén aquí, o estén
  inactivos, se ignoran: con 166 formularios en la cuenta, recibirlos todos
  significaría llenar la base de campañas de hace dos años que alguien reactive
  sin querer.

  `zona` es lo que conecta esto con la ruleta: el lead de un formulario de
  Punta Cana se reparte como un lead de Punta Cana, con la misma regla de
  equipo que los del sitio.
*/
create table if not exists public.meta_formularios (
  id          uuid primary key default gen_random_uuid(),
  form_id     text not null unique,
  nombre      text not null,
  pagina_id   uuid references public.meta_paginas(id) on delete cascade,
  activo      boolean not null default false,
  zona        text,
  -- Etiqueta para el panel y para el costo por lead: normalmente el nombre de
  -- la campaña o del gerente que la paga.
  campana     text,
  recibidos   int not null default 0,
  ultimo_en   timestamptz,
  creado_en   timestamptz not null default now()
);

create index if not exists meta_formularios_activos_idx
  on public.meta_formularios (form_id) where activo;

-- ---------- Marcas en el lead ------------------------------------------
alter table public.leads add column if not exists meta_leadgen_id text;
alter table public.leads add column if not exists meta_form_id text;
alter table public.leads add column if not exists meta_ad_id text;

/*
  Contra los duplicados.

  Meta reintenta el webhook si no contesta 200 a tiempo, y reintenta el mismo
  lead. Sin esta restricción, un pico de tráfico o un despliegue a destiempo
  crean el mismo contacto tres veces y el equipo llama tres veces a la misma
  persona. Es único pero admite nulos, así que los leads del sitio no se ven
  afectados.
*/
create unique index if not exists leads_meta_leadgen_unico
  on public.leads (meta_leadgen_id) where meta_leadgen_id is not null;

-- ---------- Permisos ----------------------------------------------------
alter table public.meta_paginas     enable row level security;
alter table public.meta_formularios enable row level security;

grant select, insert, update, delete on public.meta_paginas     to service_role;
grant select, insert, update, delete on public.meta_formularios to service_role;
revoke all on public.meta_paginas     from anon, authenticated;
revoke all on public.meta_formularios from anon, authenticated;
