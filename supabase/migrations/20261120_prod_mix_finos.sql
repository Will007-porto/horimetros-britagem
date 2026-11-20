-- Mix do secundário: fração de cada fino (Pó, Brita 01, Brita 02) no total de finos, pela média ponderada
-- de todo o histórico das balanças (total de t do material ÷ total de finos). O site usa o mix para saber quanto
-- rachão precisa ir para o secundário: o material mais exigente (meta ÷ mix) define o volume (gargalo).
-- Também devolve as metas separadas de cada mês, para o comparativo dos meses usar a mesma regra.
CREATE OR REPLACE FUNCTION public.prod_dados(p_mes date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'ultimo_dia', (select max(l.dia) from producao_lanc l)
  );
end $function$;
