-- Produtividade por hora: prod_dados passa a devolver as horas ligado do AV10 (alimentador do BM10, primário)
-- e do CV07 (secundário / finos) por dia de produção (07:30 → 07:30 do dia seguinte), no mês pedido.
-- Mesma regra do painel_dados: intervalos ligados acima de 16h seguidas são cortados em 16h (placa sem sinal).
-- 'horas' = [[dia, motor, horas], ...]
create or replace function public.prod_dados(p_mes date)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_ini date := date_trunc('month', p_mes)::date; v_fim date := (date_trunc('month', p_mes) + interval '1 month')::date;
begin
  if not app_usuario_ativo() then raise exception 'nao_autorizado'; end if;
  return json_build_object(
    'mes', (select row_to_json(m) from producao_mes m where m.mes = v_ini),
    'dias', coalesce((select json_agg(json_build_object('dia', d.dia, 'tipo', d.tipo) order by d.dia)
                        from producao_dia d where d.dia >= v_ini and d.dia < v_fim), '[]'::json),
    'lanc', coalesce((select json_agg(json_build_object('dia', l.dia, 'turno', l.turno, 'material', l.material,
                                                        'equipamento', l.equipamento, 't', l.toneladas) order by l.dia, l.turno)
                        from producao_lanc l where l.dia >= v_ini and l.dia < v_fim), '[]'::json),
    'meses', coalesce((select json_agg(x order by x.mes) from (
        select m.mes,
               m.meta_rachao_irati + m.meta_rachao_palmeira + m.meta_brita01 + m.meta_po + m.meta_brita02 as meta,
               coalesce((select sum(l.toneladas) from producao_lanc l
                          where l.dia >= m.mes and l.dia < (m.mes + interval '1 month')::date), 0) as real,
               m.meta_rachao_irati + m.meta_rachao_palmeira as meta_britado,
               m.meta_brita01 as meta_b1, m.meta_po as meta_po, m.meta_brita02 as meta_b2,
               coalesce((select sum(l.toneladas) from producao_lanc l
                          where l.material = 'RACHAO' and l.dia >= m.mes and l.dia < (m.mes + interval '1 month')::date), 0) as real_britado
          from producao_mes m) x), '[]'::json),
    'mix', (select case when sum(l.toneladas) > 0 then json_build_object(
                     'BRITA01', sum(l.toneladas) filter (where l.material = 'BRITA01') / sum(l.toneladas),
                     'PO',      sum(l.toneladas) filter (where l.material = 'PO')      / sum(l.toneladas),
                     'BRITA02', sum(l.toneladas) filter (where l.material = 'BRITA02') / sum(l.toneladas),
                     'total', sum(l.toneladas)) end
              from producao_lanc l where l.material in ('BRITA01','PO','BRITA02')),
    'horas', coalesce((
        with ev as (select motor_id m, estado, "timestamp" t,
                           lead("timestamp") over (partition by motor_id order by "timestamp") nt
                      from eventos
                     where motor_id in ('AV10','CV07')
                       and "timestamp" >= inicio_dia_producao(v_ini) - interval '2 days'
                       and "timestamp" <  inicio_dia_producao(v_fim) + interval '1 day'),
             seg as (select m, t a, least(coalesce(nt, now()), t + interval '16 hours') b from ev where estado = 'ligado'),
             dd as (select d::date d, inicio_dia_producao(d::date) d0, inicio_dia_producao(d::date + 1) d1
                      from generate_series(v_ini, v_fim - 1, interval '1 day') d),
             hd as (select s.m, dd.d, sum(extract(epoch from least(s.b, dd.d1) - greatest(s.a, dd.d0))) / 3600 h
                      from seg s join dd on s.a < dd.d1 and s.b > dd.d0 group by 1, 2)
        select json_agg(json_build_array(d, m, round(h::numeric, 2)) order by d, m) from hd where h > 0), '[]'::json),
    'ultimo_dia', (select max(l.dia) from producao_lanc l)
  );
end $function$;
