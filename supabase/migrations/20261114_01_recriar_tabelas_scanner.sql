-- Recria as tabelas usadas pela Edge Function bright-api (tinham sido apagadas,
-- o que derrubou a detecção de paradas de 01/10 a 14/11/2026).
-- RLS ligado e sem políticas: só a Edge Function (chave de serviço) acessa.

create table if not exists public.leituras (
  id uuid primary key default gen_random_uuid(),
  motor text not null,
  tipo text not null check (tipo in ('ligou','desligou')),
  "timestamp" timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists leituras_motor_ts_idx on public.leituras (motor, "timestamp" desc);

create table if not exists public.dispositivos (
  id uuid primary key default gen_random_uuid(),
  token_fcm text not null unique,
  operador_nome text not null,
  plataforma text not null default 'android',
  app_id text not null default 'com.britagem.irati',
  ativo boolean not null default true,
  ultimo_registro timestamptz not null default now()
);

create table if not exists public.notificacoes_push (
  id uuid primary key default gen_random_uuid(),
  evento_id text not null,
  token_fcm text not null,
  status text not null default 'processando',
  enviado_em timestamptz,
  resposta text,
  criado_em timestamptz not null default now(),
  unique (evento_id, token_fcm)
);

alter table public.leituras enable row level security;
alter table public.dispositivos enable row level security;
alter table public.notificacoes_push enable row level security;

create index if not exists eventos_motor_estado_ts_idx on public.eventos (motor_id, estado, "timestamp");
create index if not exists eventos_parada_aberta_idx on public.eventos_parada (motor) where fim_parada is null;
