-- Detonação: datas programadas e arquivos do plano de fogo.
-- Leitura: qualquer usuário liberado no painel (inclui visualizador). Gravação: só supervisor.
-- Arquivos ficam no bucket privado "planos-fogo", na pasta <id da detonação>/; o site baixa por link temporário.

create table public.detonacoes (
  id uuid primary key default gen_random_uuid(),
  dia date not null,
  hora time,
  local text not null default '' check (length(local) <= 120),
  obs text not null default '' check (length(obs) <= 1000),
  status text not null default 'programada' check (status in ('programada', 'realizada', 'cancelada')),
  criado_por text,
  criado_por_uid uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_por text,
  atualizado_em timestamptz not null default now()
);
create index detonacoes_dia_idx on public.detonacoes (dia desc);

create table public.detonacao_arquivos (
  id uuid primary key default gen_random_uuid(),
  detonacao_id uuid not null references public.detonacoes (id) on delete cascade,
  caminho text not null unique,
  nome text not null check (length(nome) between 1 and 200),
  tamanho bigint,
  tipo text,
  enviado_por text,
  enviado_por_uid uuid default auth.uid(),
  enviado_em timestamptz not null default now()
);
create index detonacao_arquivos_det_idx on public.detonacao_arquivos (detonacao_id);

-- Nome de quem gravou vem do cadastro, não do navegador
create or replace function public.detonacao_quem()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  select nome into v_nome from usuarios_painel where user_id = auth.uid();
  if tg_table_name = 'detonacoes' then
    if tg_op = 'INSERT' then
      new.criado_por := v_nome; new.criado_por_uid := auth.uid(); new.criado_em := now();
    else
      new.criado_por := old.criado_por; new.criado_por_uid := old.criado_por_uid; new.criado_em := old.criado_em;
    end if;
    new.atualizado_por := v_nome; new.atualizado_em := now();
  else
    new.enviado_por := v_nome; new.enviado_por_uid := auth.uid(); new.enviado_em := now();
    if split_part(new.caminho, '/', 1) <> new.detonacao_id::text then raise exception 'caminho_invalido'; end if;
  end if;
  return new;
end $$;
revoke execute on function public.detonacao_quem() from public, anon, authenticated;

create trigger detonacoes_quem before insert or update on public.detonacoes
  for each row execute function public.detonacao_quem();
create trigger detonacao_arquivos_quem before insert on public.detonacao_arquivos
  for each row execute function public.detonacao_quem();

alter table public.detonacoes enable row level security;
alter table public.detonacao_arquivos enable row level security;
revoke all on public.detonacoes, public.detonacao_arquivos from anon;
revoke all on public.detonacoes, public.detonacao_arquivos from authenticated;
grant select, insert, update, delete on public.detonacoes to authenticated;
grant select, insert, delete on public.detonacao_arquivos to authenticated;

create policy "leitura usuarios liberados" on public.detonacoes for select to authenticated
  using ((select app_usuario_ativo()));
create policy "supervisor grava" on public.detonacoes for all to authenticated
  using ((select app_eh_supervisor())) with check ((select app_eh_supervisor()));
create policy "leitura usuarios liberados" on public.detonacao_arquivos for select to authenticated
  using ((select app_usuario_ativo()));
create policy "supervisor envia" on public.detonacao_arquivos for insert to authenticated
  with check ((select app_eh_supervisor()));
create policy "supervisor apaga" on public.detonacao_arquivos for delete to authenticated
  using ((select app_eh_supervisor()));

-- Bucket privado, até 25 MB por arquivo
insert into storage.buckets (id, name, public, file_size_limit)
values ('planos-fogo', 'planos-fogo', false, 26214400)
on conflict (id) do nothing;

create policy "planos-fogo leitura" on storage.objects for select to authenticated
  using (bucket_id = 'planos-fogo' and (select public.app_usuario_ativo()));
create policy "planos-fogo envio supervisor" on storage.objects for insert to authenticated
  with check (bucket_id = 'planos-fogo' and (select public.app_eh_supervisor()));
create policy "planos-fogo apaga supervisor" on storage.objects for delete to authenticated
  using (bucket_id = 'planos-fogo' and (select public.app_eh_supervisor()));

-- Número do fogo (ex.: Fogo 12), como nos planos de fogo e ordens de serviço
alter table public.detonacoes add column numero integer check (numero between 1 and 99999);
