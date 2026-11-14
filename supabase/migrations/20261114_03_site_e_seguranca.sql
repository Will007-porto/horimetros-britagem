-- Site público (GitHub Pages) lendo o Supabase com a chave publishable.
-- Leitura: funções painel_* (somente leitura, liberadas para anon).
-- Escrita: só painel_justificar, que exige login E o usuário cadastrado em usuarios_painel.
-- Também fecha a escrita pública que existia em tabelas antigas.

-- ============ Usuários autorizados a justificar ============
create table if not exists public.usuarios_painel (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
alter table public.usuarios_painel enable row level security; -- sem políticas: ninguém lê/escreve pela API

-- ============ Leitura: dados gerais do painel ============
create or replace function public.painel_dados()
returns json
language sql stable security definer
set search_path = public
as $$
with hoje as (select (now() at time zone 'America/Sao_Paulo')::date d),
ev as (select motor_id m, estado, "timestamp" t, lead("timestamp") over (partition by motor_id order by "timestamp") nt
  from eventos where "timestamp" > now() - interval '100 days'),
seg as (select m, t a, least(coalesce(nt, now()), t + interval '16 hours') b from ev where estado = 'ligado'),
dias as (select generate_series((select d from hoje) - 89, (select d from hoje), interval '1 day')::date d),
hd as (select s.m, d.d,
  sum(extract(epoch from least(s.b, (d.d + 1)::timestamp at time zone 'America/Sao_Paulo') - greatest(s.a, d.d::timestamp at time zone 'America/Sao_Paulo'))) / 3600 h
  from seg s join dias d on s.a < (d.d + 1)::timestamp at time zone 'America/Sao_Paulo' and s.b > d.d::timestamp at time zone 'America/Sao_Paulo'
  group by 1, 2),
jw as (select * from janelas_produtivas(((select d from hoje) - 89)::timestamp at time zone 'America/Sao_Paulo', now())),
hjc as (select s.m, j.dia, j.turno, sum(extract(epoch from least(s.b, j.fim) - greatest(s.a, j.inicio))) / 3600 h
  from seg s join jw j on s.a < j.fim and s.b > j.inicio group by 1, 2, 3),
pt as (select motor_id m, ("timestamp" at time zone 'America/Sao_Paulo')::date d, count(*) n
  from eventos where estado = 'ligado' and "timestamp" >= ((select d from hoje) - 89)::timestamp at time zone 'America/Sao_Paulo' group by 1, 2)
select json_build_object(
 'gerado', now(),
 'hoje', (select d from hoje),
 'maq', (select json_agg(json_build_object('id', id, 'nome', nome, 'h', round(horas_acumuladas, 2), 'st', ultimo_estado, 'up', ultima_atualizacao) order by id) from maquinas),
 'ult', (select json_object_agg(m, t) from (select motor_id m, max("timestamp") t from eventos group by 1) z),
 'placa', (select json_agg(json_build_object('id', id, 'up', ultima_atualizacao)) from placas),
 'hd', (select coalesce(json_agg(json_build_array(m, d, round(h::numeric, 2)) order by d, m), '[]') from hd),
 'jw', (select coalesce(json_agg(json_build_array(dia, turno, round(extract(epoch from inicio)), round(extract(epoch from least(fim, now())))) order by inicio), '[]') from jw where inicio < now()),
 'hj', (select coalesce(json_agg(json_build_array(m, dia, turno, round(h::numeric, 2))), '[]') from hjc),
 'pt', (select coalesce(json_agg(json_build_array(m, d, n) order by d, m), '[]') from pt),
 'ps', (select json_build_object('pend', count(*) filter (where status = 'aguardando_justificativa' or (status = 'pendente' and fim_parada is not null)), 'ab', count(*) filter (where status = 'pendente' and fim_parada is null), 'min', min(inicio_parada) filter (where status <> 'justificado'), 'ult', max(inicio_parada), 'n', count(*)) from eventos_parada),
 'eqn', (select json_object_agg(codigo, nome_exibicao) from paradas_equipamentos)
);
$$;

-- ============ Leitura: Gantt de um dia de produção (06h → 06h) ============
create or replace function public.painel_gantt(p_dia date)
returns json
language sql stable security definer
set search_path = public
as $$
with r as (select (p_dia + time '06:00') at time zone 'America/Sao_Paulo' d0, (p_dia + 1 + time '06:00') at time zone 'America/Sao_Paulo' d1),
ev as (select motor_id m, estado, "timestamp" t, lead("timestamp") over (partition by motor_id order by "timestamp") nt
       from eventos, r where "timestamp" >= r.d0 - interval '1 day' and "timestamp" < r.d1 + interval '1 day')
select json_build_object(
  'dia', p_dia,
  'seg', (select coalesce(json_agg(json_build_array(m, round(extract(epoch from greatest(t, r.d0))), round(extract(epoch from least(coalesce(nt, now()), t + interval '16 hours', r.d1)))) order by m, t), '[]')
          from ev, r where estado = 'ligado' and t < r.d1 and least(coalesce(nt, now()), t + interval '16 hours') > r.d0),
  't0', (select extract(epoch from d0) from r),
  'jan', (select coalesce(json_agg(json_build_array(j.turno, round(extract(epoch from j.inicio)), round(extract(epoch from j.fim))) order by j.inicio), '[]')
          from r, janelas_produtivas(r.d0, r.d1) j where j.dia = p_dia)
);
$$;

-- ============ Leitura: paradas (período ou todas as pendentes) + árvore de motivos ============
create or replace function public.painel_paradas(p_desde date, p_ate date, p_pendentes boolean default false)
returns json
language sql stable security definer
set search_path = public
as $$
select json_build_object(
  'rows', (select coalesce(json_agg(json_build_array(id, motor, estagio, inicio_parada, fim_parada, status, tipo, categoria, justificativa_texto, justificado_por, justificado_em) order by inicio_parada desc), '[]')
           from (select * from eventos_parada
                 where case when p_pendentes then status in ('pendente','aguardando_justificativa')
                            else inicio_parada >= p_desde::timestamp at time zone 'America/Sao_Paulo'
                             and inicio_parada < (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo' end
                 order by inicio_parada desc limit 1500) e),
  'arv', (select coalesce(json_agg(json_build_array(id, parent_id, area, nivel, nome, ordem) order by area, nivel, ordem, nome), '[]')
          from paradas_arvore where ativo)
);
$$;

-- ============ Quem sou eu (para o site mostrar nome / permissão) ============
create or replace function public.painel_eu()
returns json
language sql stable security definer
set search_path = public
as $$
  select json_build_object(
    'logado', auth.uid() is not null,
    'nome', (select nome from usuarios_painel where user_id = auth.uid() and ativo),
    'autorizado', exists (select 1 from usuarios_painel where user_id = auth.uid() and ativo)
  );
$$;

-- ============ Escrita: justificar paradas (exige login + cadastro) ============
create or replace function public.painel_justificar(
  p_ids text[], p_classificacao text, p_motivo text, p_tipo text default 'nao_programada', p_texto text default null)
returns json
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_nome text;
  v_n integer;
begin
  select nome into v_nome from usuarios_painel where user_id = auth.uid() and ativo;
  if v_nome is null then
    raise exception 'nao_autorizado' using hint = 'Usuário não cadastrado em usuarios_painel.';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then
    raise exception 'selecao_invalida';
  end if;
  if not exists (
    select 1 from paradas_arvore m join paradas_arvore c on c.id = m.parent_id
    where m.ativo and c.ativo and m.nivel = 'MOTIVO' and c.nivel = 'CLASSIFICACAO'
      and c.nome = p_classificacao and m.nome = p_motivo) then
    raise exception 'motivo_invalido';
  end if;
  if p_tipo not in ('nao_programada','programada') then
    raise exception 'tipo_invalido';
  end if;
  if length(coalesce(p_texto, '')) > 500 then
    raise exception 'texto_longo';
  end if;
  if p_motivo in ('Outro','Não sei') and length(btrim(coalesce(p_texto, ''))) < 3 then
    raise exception 'observacao_obrigatoria';
  end if;

  update eventos_parada
     set status = 'justificado',
         categoria = p_classificacao || ' › ' || p_motivo,
         tipo = p_tipo,
         justificativa_texto = coalesce(nullif(btrim(p_texto), ''), 'Sem observações.'),
         justificado_por = v_nome,
         justificado_em = now()
   where id = any (p_ids);
  get diagnostics v_n = row_count;
  return json_build_object('n', v_n, 'por', v_nome, 'em', now());
end;
$$;

revoke all on function public.painel_dados() from public;
revoke all on function public.painel_gantt(date) from public;
revoke all on function public.painel_paradas(date, date, boolean) from public;
revoke all on function public.painel_eu() from public;
revoke all on function public.painel_justificar(text[], text, text, text, text) from public;
grant execute on function public.painel_dados() to anon, authenticated;
grant execute on function public.painel_gantt(date) to anon, authenticated;
grant execute on function public.painel_paradas(date, date, boolean) to anon, authenticated;
grant execute on function public.painel_eu() to anon, authenticated;
grant execute on function public.painel_justificar(text[], text, text, text, text) to authenticated;

-- ============ Fechar escrita pública antiga ============
-- (Logs de 24h confirmaram: APK e placa acessam só via Edge Function bright-api, com a chave de serviço.)
drop policy if exists "Permitir acesso total a eventos_parada" on public.eventos_parada;
create policy "leitura eventos_parada" on public.eventos_parada for select to anon, authenticated using (true);

drop policy if exists "permite upsert placas" on public.placas;
drop policy if exists "permite insert de eventos" on public.eventos;
drop policy if exists "Permitir tudo para anon" on public.tarefas;

revoke execute on function public.justificar_paradas(uuid[], integer, text) from anon, public;
revoke execute on function public.claim_logical_stop(text, text, text, timestamptz, timestamptz, text, text, text, text, text, timestamptz, integer) from anon, public;
grant execute on function public.claim_logical_stop(text, text, text, timestamptz, timestamptz, text, text, text, text, text, timestamptz, integer) to service_role;
grant execute on function public.justificar_paradas(uuid[], integer, text) to service_role;
grant execute on function public.janelas_produtivas(timestamptz, timestamptz) to service_role;

-- O Supabase concede EXECUTE ao anon por padrão em funções novas do schema public:
-- revogar explicitamente (a função também confere o login internamente).
revoke execute on function public.painel_justificar(text[], text, text, text, text) from anon;
