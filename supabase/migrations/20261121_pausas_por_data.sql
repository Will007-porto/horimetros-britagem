-- Pausas (almoço / janta) ajustáveis por data, sem reescrever o passado.
--
-- 1) pausas_dia: ajuste de um dia específico (ex.: "21/11, 1º turno: almoço 11:30–12:30").
--    Substitui as pausas do padrão só naquele dia e turno. pausas = '[]' quer dizer "sem pausa nesse dia".
-- 2) pausas_hist: quando o padrão muda de vez (a partir de uma data), o padrão antigo é guardado aqui com
--    valido_ate = véspera da mudança. Assim os dias anteriores continuam usando o horário que valia na época.
--    pausas_config segue sendo o padrão ATUAL (o aplicativo Android lê essa tabela para sugerir "refeição").
-- 3) janelas_produtivas passa a escolher, para cada dia e turno: ajuste do dia > padrão histórico > padrão atual.
--    Tudo que usa janelas_produtivas (painel_dados, painel_gantt, app_turnos_abertos, reprocessar_paradas) acompanha.

create table if not exists public.pausas_dia (
  dia date not null,
  turno smallint not null check (turno in (1, 2)),
  pausas jsonb not null default '[]'::jsonb check (jsonb_typeof(pausas) = 'array'),
  por uuid,
  por_nome text,
  em timestamptz not null default now(),
  primary key (dia, turno)
);
alter table public.pausas_dia enable row level security;
create policy "leitura pausas_dia" on public.pausas_dia for select to anon, authenticated using (true);

create table if not exists public.pausas_hist (
  dia_semana smallint not null,
  turno smallint not null,
  pausas jsonb not null default '[]'::jsonb,
  valido_ate date not null,
  em timestamptz not null default now(),
  por uuid,
  primary key (dia_semana, turno, valido_ate)
);
alter table public.pausas_hist enable row level security;
create policy "leitura pausas_hist" on public.pausas_hist for select to anon, authenticated using (true);

create or replace function public.janelas_produtivas(p_desde timestamp with time zone, p_ate timestamp with time zone)
 returns table(dia date, turno smallint, turno_inicio timestamp with time zone, turno_fim timestamp with time zone, inicio timestamp with time zone, fim timestamp with time zone)
 language sql
 stable
 set search_path to 'public'
as $function$
  with dias as (
    select d::date d
    from generate_series((p_desde at time zone 'America/Sao_Paulo')::date - 1,
                         (p_ate at time zone 'America/Sao_Paulo')::date, interval '1 day') d
  ),
  tur as (
    select dd.d dia, t.turno, t.dia_semana, t.inicio hi, t.eventual,
           (dd.d + t.inicio) at time zone 'America/Sao_Paulo' ti,
           (dd.d + t.fim + case when t.fim <= t.inicio then interval '1 day' else interval '0' end) at time zone 'America/Sao_Paulo' tf
    from dias dd
    join turnos_config t on t.ativo and t.dia_semana = extract(isodow from dd.d)
  ),
  tur_ok as (
    select * from tur
    where not eventual
       or exists (select 1 from eventos e where e.estado = 'ligado' and e."timestamp" >= tur.ti and e."timestamp" < tur.tf)
  ),
  -- pausas valendo em cada dia/turno: ajuste do dia > padrão histórico (o mais próximo que ainda valia) > padrão atual
  pz as (
    select tu.dia, tu.turno, tu.hi, x.ini, x.fim
    from tur_ok tu
    cross join lateral (
      select (j->>'inicio')::time ini, (j->>'fim')::time fim
        from pausas_dia pd, jsonb_array_elements(pd.pausas) j
       where pd.dia = tu.dia and pd.turno = tu.turno
      union all
      select (j->>'inicio')::time, (j->>'fim')::time
        from pausas_hist h, jsonb_array_elements(h.pausas) j
       where not exists (select 1 from pausas_dia pd where pd.dia = tu.dia and pd.turno = tu.turno)
         and h.dia_semana = tu.dia_semana and h.turno = tu.turno
         and h.valido_ate = (select min(h2.valido_ate) from pausas_hist h2
                              where h2.dia_semana = tu.dia_semana and h2.turno = tu.turno and h2.valido_ate >= tu.dia)
      union all
      select p.inicio, p.fim
        from pausas_config p
       where p.ativo and p.dia_semana = tu.dia_semana and p.turno = tu.turno
         and not exists (select 1 from pausas_dia pd where pd.dia = tu.dia and pd.turno = tu.turno)
         and not exists (select 1 from pausas_hist h2 where h2.dia_semana = tu.dia_semana and h2.turno = tu.turno and h2.valido_ate >= tu.dia)
    ) x
  ),
  pau as (
    select pz.dia, pz.turno,
           (pz.dia + pz.ini + case when pz.ini < pz.hi then interval '1 day' else interval '0' end) at time zone 'America/Sao_Paulo' pi,
           (pz.dia + pz.fim + case when pz.fim <= pz.hi then interval '1 day' else interval '0' end) at time zone 'America/Sao_Paulo' pf
    from pz
  ),
  cortes as (
    select tu.dia, tu.turno, tu.ti, tu.tf, tu.ti a from tur_ok tu
    union all
    select tu.dia, tu.turno, tu.ti, tu.tf, p.pf from tur_ok tu join pau p using (dia, turno) where p.pf > tu.ti and p.pf < tu.tf
  ),
  jan as (
    select c.dia, c.turno, c.ti, c.tf, c.a,
           least(c.tf, coalesce((select min(p.pi) from pau p where p.dia = c.dia and p.turno = c.turno and p.pi >= c.a), c.tf)) b
    from cortes c
  )
  select dia, turno, ti, tf, a, b
  from jan
  where b > a and a < p_ate and b > p_desde
  order by a;
$function$;

-- Pausas de um dia de produção, por turno: horário do turno, pausas valendo e de onde vêm ('dia' ou 'padrao').
create or replace function public.app_pausas_dia(p_dia date)
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(json_agg(json_build_object(
           'turno', t.turno, 'inicio', to_char(t.inicio, 'HH24:MI'), 'fim', to_char(t.fim, 'HH24:MI'), 'eventual', t.eventual,
           'origem', case when pd.dia is not null then 'dia' else 'padrao' end,
           'por', pd.por_nome, 'em', pd.em,
           'pausas', coalesce(pd.pausas,
                       (select h.pausas from pausas_hist h where h.dia_semana = t.dia_semana and h.turno = t.turno and h.valido_ate >= p_dia
                         order by h.valido_ate limit 1),
                       (select coalesce(jsonb_agg(jsonb_build_object('nome', p.nome, 'inicio', to_char(p.inicio, 'HH24:MI'), 'fim', to_char(p.fim, 'HH24:MI')) order by p.inicio), '[]'::jsonb)
                          from pausas_config p where p.ativo and p.dia_semana = t.dia_semana and p.turno = t.turno))
         ) order by t.turno), '[]'::json)
  from turnos_config t
  left join pausas_dia pd on pd.dia = p_dia and pd.turno = t.turno
  where t.ativo and t.dia_semana = extract(isodow from p_dia) and app_usuario_ativo();
$function$;

-- Salvar (supervisor). p_modo: 'dia' = só neste dia; 'padrao' = muda o padrão deste dia da semana a partir de p_dia;
-- 'limpar' = desfaz o ajuste do dia (volta ao padrão).
-- p_pausas = [{"nome":"Almoço","inicio":"11:30","fim":"12:30"}, ...]
create or replace function public.app_pausas_salvar(p_dia date, p_turno smallint, p_pausas jsonb, p_modo text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_dow smallint := extract(isodow from p_dia); e jsonb; v_ini time; v_fim time; v_dur interval; v_nome text;
        v_lista jsonb := '[]'::jsonb; v_atual jsonb;
begin
  if not app_eh_supervisor() then raise exception 'nao_autorizado'; end if;
  if p_dia is null or p_turno not in (1, 2) then raise exception 'dados_invalidos'; end if;
  if p_modo not in ('dia', 'padrao', 'limpar') then raise exception 'modo_invalido'; end if;
  if not exists (select 1 from turnos_config t where t.ativo and t.dia_semana = v_dow and t.turno = p_turno) then
    raise exception 'turno_inexistente'; end if;

  if p_modo = 'limpar' then
    delete from pausas_dia where dia = p_dia and turno = p_turno;
    return json_build_object('ok', true);
  end if;

  if jsonb_typeof(coalesce(p_pausas, '[]')) <> 'array' or jsonb_array_length(coalesce(p_pausas, '[]')) > 4 then
    raise exception 'pausas_invalidas'; end if;
  for e in select * from jsonb_array_elements(coalesce(p_pausas, '[]')) loop
    begin
      v_ini := (e->>'inicio')::time; v_fim := (e->>'fim')::time;
    exception when others then raise exception 'horario_invalido'; end;
    if v_ini is null or v_fim is null or v_ini = v_fim then raise exception 'horario_invalido'; end if;
    v_dur := case when v_fim > v_ini then v_fim - v_ini else v_fim - v_ini + interval '24 hours' end;
    if v_dur > interval '3 hours' then raise exception 'pausa_longa'; end if;
    v_nome := left(coalesce(nullif(trim(e->>'nome'), ''), case when p_turno = 1 then 'Almoço' else 'Janta' end), 40);
    v_lista := v_lista || jsonb_build_object('nome', v_nome, 'inicio', to_char(v_ini, 'HH24:MI'), 'fim', to_char(v_fim, 'HH24:MI'));
  end loop;

  if p_modo = 'dia' then
    insert into pausas_dia (dia, turno, pausas, por, por_nome, em)
    values (p_dia, p_turno, v_lista, auth.uid(), (select nome from usuarios_painel where user_id = auth.uid()), now())
    on conflict (dia, turno) do update set pausas = excluded.pausas, por = excluded.por, por_nome = excluded.por_nome, em = now();
    return json_build_object('ok', true);
  end if;

  -- padrão a partir de p_dia: guarda o padrão atual como histórico até a véspera e troca o padrão
  if exists (select 1 from pausas_hist h where h.dia_semana = v_dow and h.turno = p_turno and h.valido_ate >= p_dia) then
    raise exception 'mudanca_posterior'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('nome', p.nome, 'inicio', to_char(p.inicio, 'HH24:MI'), 'fim', to_char(p.fim, 'HH24:MI')) order by p.inicio), '[]'::jsonb)
    into v_atual from pausas_config p where p.ativo and p.dia_semana = v_dow and p.turno = p_turno;
  insert into pausas_hist (dia_semana, turno, pausas, valido_ate, por)
  values (v_dow, p_turno, v_atual, p_dia - 1, auth.uid())
  on conflict (dia_semana, turno, valido_ate) do nothing;
  delete from pausas_config where dia_semana = v_dow and turno = p_turno;
  insert into pausas_config (dia_semana, turno, nome, inicio, fim, ativo)
  select v_dow, p_turno, x->>'nome', (x->>'inicio')::time, (x->>'fim')::time, true from jsonb_array_elements(v_lista) x;
  return json_build_object('ok', true);
end $function$;

revoke all on function public.app_pausas_salvar(date, smallint, jsonb, text) from public, anon;
grant execute on function public.app_pausas_salvar(date, smallint, jsonb, text) to authenticated;
revoke all on function public.app_pausas_dia(date) from public, anon;
grant execute on function public.app_pausas_dia(date) to authenticated;

-- Gantt: informa quais turnos do dia têm pausa ajustada (para mostrar o aviso no gráfico)
create or replace function public.painel_gantt(p_dia date)
 returns json
 language sql
 stable
 set search_path to 'public'
as $function$
with r as (select inicio_dia_producao(p_dia) d0, inicio_dia_producao(p_dia + 1) d1),
ev as (select motor_id m, estado, "timestamp" t, lead("timestamp") over (partition by motor_id order by "timestamp") nt
       from eventos, r where "timestamp" >= r.d0 - interval '1 day' and "timestamp" < r.d1 + interval '1 day')
select json_build_object(
  'dia', p_dia,
  'seg', (select coalesce(json_agg(json_build_array(m, round(extract(epoch from greatest(t, r.d0))), round(extract(epoch from least(coalesce(nt, now()), t + interval '16 hours', r.d1)))) order by m, t), '[]')
          from ev, r where estado = 'ligado' and t < r.d1 and least(coalesce(nt, now()), t + interval '16 hours') > r.d0),
  't0', (select extract(epoch from d0) from r),
  'jan', (select coalesce(json_agg(json_build_array(j.turno, round(extract(epoch from j.inicio)), round(extract(epoch from j.fim))) order by j.inicio), '[]')
          from r, janelas_produtivas(r.d0, r.d1) j where j.dia = p_dia),
  'paj', (select coalesce(json_agg(pd.turno order by pd.turno), '[]') from pausas_dia pd where pd.dia = p_dia),
  'par', (select coalesce(json_agg(json_build_array(
              e.id, e.motor, e.estagio, e.inicio_parada, e.fim_parada, e.status, e.tipo, e.categoria, e.justificativa_texto,
              e.justificado_por, e.justificado_em,
              e.codigo_motivo, e.equipamento_causa, e.classe, e.confirmacao_manutencao, e.confirmado_por, e.confirmacao_obs
            ) order by e.inicio_parada), '[]')
          from eventos_parada e, r
          where e.motor in ('AV10', 'CV07')
            and e.inicio_parada < r.d1 and coalesce(e.fim_parada, now()) > r.d0)
);
$function$;
