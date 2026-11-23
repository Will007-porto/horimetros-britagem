-- Programação do dia vem do calendário das metas (aba Produção → Metas do mês):
--   X   = programação normal (turnos de segunda a sexta)
--   XX  = regra de sábado
--   A   = ADM: um turno só, 07:30–16:00 com almoço 12:30–13:30 (domingo/feriado quando precisa)
--   (vazio) = sem programação; se a planta ligar no dia, ele vira ADM sozinho
-- Mês sem calendário cadastrado: padrão da semana (seg–sex X, sáb XX, dom vazio).
-- Os horários continuam em turnos_config / pausas_*: X usa o dia da semana (seg–sex), XX usa o sábado (6), A usa o domingo (7).

alter table public.producao_dia drop constraint if exists producao_dia_tipo_check;
alter table public.producao_dia add constraint producao_dia_tipo_check check (tipo in ('X','XX','A'));
alter table public.producao_mes add column if not exists peso_adm numeric not null default 0.4054;  -- 7,5 h ÷ 18,5 h do dia normal

-- Turno ADM: domingo (7) deixa de ser "eventual" na tabela; quem decide agora é o calendário
update public.turnos_config set inicio = '07:30', fim = '16:00' where dia_semana = 7 and turno = 1;

create or replace function public.programacao_dia(p_dia date)
 returns table(tipo text, dia_semana smallint, eventual boolean, cadastrado boolean)
 language sql stable set search_path to 'public'
as $function$
  with x as (
    select pd.tipo t,
           exists (select 1 from producao_dia c
                    where c.dia >= date_trunc('month', p_dia)::date
                      and c.dia < (date_trunc('month', p_dia) + interval '1 month')::date) cal,
           extract(isodow from p_dia)::smallint dw
      from (select 1) z left join producao_dia pd on pd.dia = p_dia),
  y as (select coalesce(t, case when cal then null when dw <= 5 then 'X' when dw = 6 then 'XX' end) tp, dw, cal from x)
  select tp,
         (case tp when 'X' then case when dw <= 5 then dw else 1 end when 'XX' then 6 else 7 end)::smallint,
         tp is null,
         cal
    from y;
$function$;
grant execute on function public.programacao_dia(date) to authenticated;

create or replace function public.janelas_produtivas(p_desde timestamp with time zone, p_ate timestamp with time zone)
 returns table(dia date, turno smallint, turno_inicio timestamp with time zone, turno_fim timestamp with time zone, inicio timestamp with time zone, fim timestamp with time zone)
 language sql stable set search_path to 'public'
as $function$
  with dias as (
    select d::date d
    from generate_series((p_desde at time zone 'America/Sao_Paulo')::date - 1,
                         (p_ate at time zone 'America/Sao_Paulo')::date, interval '1 day') d
  ),
  tur as (
    select dd.d dia, t.turno, pg.dia_semana, t.inicio hi, pg.eventual,
           (dd.d + t.inicio) at time zone 'America/Sao_Paulo' ti,
           (dd.d + t.fim + case when t.fim <= t.inicio then interval '1 day' else interval '0' end) at time zone 'America/Sao_Paulo' tf
    from dias dd
    cross join lateral programacao_dia(dd.d) pg
    join turnos_config t on t.ativo and t.dia_semana = pg.dia_semana
  ),
  tur_ok as (
    select * from tur
    where not eventual
       or exists (select 1 from eventos e where e.estado = 'ligado' and e."timestamp" >= tur.ti and e."timestamp" < tur.tf)
  ),
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

-- Gantt: devolve também a programação do dia (para o rótulo e para saber se virou ADM sozinho)
create or replace function public.painel_gantt(p_dia date)
 returns json language sql stable set search_path to 'public'
as $function$
with r as (select inicio_dia_producao(p_dia) d0, inicio_dia_producao(p_dia + 1) d1),
ev as (select motor_id m, estado, "timestamp" t, lead("timestamp") over (partition by motor_id order by "timestamp") nt
       from eventos, r where "timestamp" >= r.d0 - interval '1 day' and "timestamp" < r.d1 + interval '1 day')
select json_build_object(
  'dia', p_dia,
  'prog', (select json_build_object('tipo', pg.tipo, 'eventual', pg.eventual, 'cadastrado', pg.cadastrado) from programacao_dia(p_dia) pg),
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

-- Pausas do dia (Gantt): usa os turnos da programação do dia
create or replace function public.app_pausas_dia(p_dia date)
 returns json language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(json_agg(json_build_object(
           'turno', t.turno, 'inicio', to_char(t.inicio, 'HH24:MI'), 'fim', to_char(t.fim, 'HH24:MI'), 'eventual', pg.eventual,
           'origem', case when pd.dia is not null then 'dia' else 'padrao' end,
           'por', pd.por_nome, 'em', pd.em,
           'pausas', coalesce(pd.pausas,
                       (select h.pausas from pausas_hist h where h.dia_semana = t.dia_semana and h.turno = t.turno and h.valido_ate >= p_dia
                         order by h.valido_ate limit 1),
                       (select coalesce(jsonb_agg(jsonb_build_object('nome', p.nome, 'inicio', to_char(p.inicio, 'HH24:MI'), 'fim', to_char(p.fim, 'HH24:MI')) order by p.inicio), '[]'::jsonb)
                          from pausas_config p where p.ativo and p.dia_semana = t.dia_semana and p.turno = t.turno))
         ) order by t.turno), '[]'::json)
  from programacao_dia(p_dia) pg
  join turnos_config t on t.ativo and t.dia_semana = pg.dia_semana
  left join pausas_dia pd on pd.dia = p_dia and pd.turno = t.turno
  where app_usuario_ativo();
$function$;

-- Salvar pausas: "padrão" vale para o tipo de dia da programação (seg–sex, sábado ou ADM)
create or replace function public.app_pausas_salvar(p_dia date, p_turno smallint, p_pausas jsonb, p_modo text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_dow smallint := (select dia_semana from programacao_dia(p_dia)); e jsonb; v_ini time; v_fim time; v_dur interval; v_nome text;
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

-- Metas do mês: aceita dia A (ADM) e o peso do dia ADM
drop function if exists public.prod_salvar_mes(date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb);
create or replace function public.prod_salvar_mes(p_mes date, p_meta_rachao_irati numeric, p_meta_rachao_palmeira numeric, p_meta_brita01 numeric,
  p_meta_po numeric, p_meta_brita02 numeric, p_peso_sabado numeric, p_pct_bm10 numeric, p_dias jsonb, p_peso_adm numeric default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_ini date := date_trunc('month', p_mes)::date; v_fim date := (date_trunc('month', p_mes) + interval '1 month')::date; e jsonb; v_dia date; v_tipo text;
        v_adm numeric := coalesce(p_peso_adm, (select peso_adm from producao_mes where mes = date_trunc('month', p_mes)::date), 0.4054);
begin
  if not app_eh_supervisor() then raise exception 'nao_autorizado'; end if;
  if least(p_meta_rachao_irati, p_meta_rachao_palmeira, p_meta_brita01, p_meta_po, p_meta_brita02) < 0
     or greatest(p_meta_rachao_irati, p_meta_rachao_palmeira, p_meta_brita01, p_meta_po, p_meta_brita02) > 2000000 then
    raise exception 'meta_invalida'; end if;
  if p_peso_sabado is null or p_peso_sabado <= 0 or p_peso_sabado > 1 then raise exception 'peso_invalido'; end if;
  if v_adm <= 0 or v_adm > 1 then raise exception 'peso_invalido'; end if;
  if p_pct_bm10 is null or p_pct_bm10 < 0 or p_pct_bm10 > 1 then raise exception 'pct_invalido'; end if;
  if jsonb_typeof(coalesce(p_dias, '[]')) <> 'array' then raise exception 'dias_invalidos'; end if;

  insert into producao_mes as m (mes, meta_rachao_irati, meta_rachao_palmeira, meta_brita01, meta_po, meta_brita02, peso_sabado, peso_adm, pct_bm10, atualizado_em, atualizado_por)
  values (v_ini, coalesce(p_meta_rachao_irati,0), coalesce(p_meta_rachao_palmeira,0), coalesce(p_meta_brita01,0), coalesce(p_meta_po,0), coalesce(p_meta_brita02,0), p_peso_sabado, v_adm, p_pct_bm10, now(), auth.uid())
  on conflict (mes) do update set meta_rachao_irati = excluded.meta_rachao_irati, meta_rachao_palmeira = excluded.meta_rachao_palmeira,
    meta_brita01 = excluded.meta_brita01, meta_po = excluded.meta_po, meta_brita02 = excluded.meta_brita02,
    peso_sabado = excluded.peso_sabado, peso_adm = excluded.peso_adm, pct_bm10 = excluded.pct_bm10, atualizado_em = now(), atualizado_por = auth.uid();

  delete from producao_dia where dia >= v_ini and dia < v_fim;
  for e in select * from jsonb_array_elements(coalesce(p_dias, '[]')) loop
    v_dia := (e->>'dia')::date; v_tipo := upper(e->>'tipo');
    if v_dia < v_ini or v_dia >= v_fim then raise exception 'dia_fora_do_mes'; end if;
    if v_tipo not in ('X','XX','A') then raise exception 'dias_invalidos'; end if;
    insert into producao_dia (dia, tipo) values (v_dia, v_tipo) on conflict (dia) do update set tipo = excluded.tipo;
  end loop;
  return json_build_object('ok', true, 'mes', v_ini);
end $function$;
revoke all on function public.prod_salvar_mes(date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, numeric) from public, anon;
grant execute on function public.prod_salvar_mes(date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, numeric) to authenticated;
