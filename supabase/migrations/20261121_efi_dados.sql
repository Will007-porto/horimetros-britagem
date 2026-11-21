-- Aba Eficiência: aproveitamento do tempo do turno.
-- Por dia de produção e turno devolve:
--   inicio/fim do turno (fim cortado em agora), horas do turno inteiro e horas disponíveis (turno menos pausas,
--   pelas janelas_produtivas), horas rodando do AV10 (primário, BM10) e do CV07 (secundário / finos)
--   no turno inteiro e só dentro das janelas, e as toneladas lançadas (rachão do BM10 e finos: BRITA01 + PO + BRITA02).
-- Mesma regra de horas do painel: intervalos ligados acima de 16h seguidas são cortados em 16h.
create or replace function public.efi_dados(p_desde date, p_ate date)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not app_usuario_ativo() then raise exception 'nao_autorizado'; end if;
  if p_ate < p_desde or p_ate - p_desde > 400 then raise exception 'periodo_invalido'; end if;
  return coalesce((
    with jp as (select * from janelas_produtivas(p_desde, p_ate + 1) j where j.dia between p_desde and p_ate and j.inicio < now()),
         tu as (select dia, turno, min(turno_inicio) ti, least(min(turno_fim), now()) tf,
                       sum(extract(epoch from least(fim, now()) - inicio)) / 3600 hd
                  from jp group by 1, 2),
         ev as (select motor_id m, estado, "timestamp" t,
                       lead("timestamp") over (partition by motor_id order by "timestamp") nt
                  from eventos
                 where motor_id in ('AV10','CV07')
                   and "timestamp" >= inicio_dia_producao(p_desde) - interval '2 days'
                   and "timestamp" <  inicio_dia_producao(p_ate + 1) + interval '1 day'),
         seg as (select m, t a, least(coalesce(nt, now()), t + interval '16 hours') b from ev where estado = 'ligado'),
         ht as (select tu.dia, tu.turno, s.m,
                       sum(extract(epoch from least(s.b, tu.tf) - greatest(s.a, tu.ti))) / 3600 h
                  from tu join seg s on s.a < tu.tf and s.b > tu.ti group by 1, 2, 3),
         hj as (select jp.dia, jp.turno, s.m,
                       sum(extract(epoch from least(s.b, jp.fim, now()) - greatest(s.a, jp.inicio))) / 3600 h
                  from jp join seg s on s.a < least(jp.fim, now()) and s.b > jp.inicio group by 1, 2, 3),
         pl as (select l.dia, l.turno::int turno,
                       sum(l.toneladas) filter (where l.material = 'RACHAO' and l.equipamento = 'BM10') t_bm10,
                       sum(l.toneladas) filter (where l.material in ('BRITA01','PO','BRITA02')) t_finos
                  from producao_lanc l where l.dia between p_desde and p_ate group by 1, 2),
         k as (select dia, turno::int turno from tu union select dia, turno from pl)
    select json_agg(json_build_object(
             'dia', k.dia, 'turno', k.turno, 'ini', tu.ti, 'fim', tu.tf,
             'ht', round(coalesce(extract(epoch from tu.tf - tu.ti) / 3600, 0)::numeric, 2),
             'hd', round(coalesce(tu.hd, 0)::numeric, 2),
             'av', round(coalesce((select h from ht where ht.dia = k.dia and ht.turno = k.turno and ht.m = 'AV10'), 0)::numeric, 2),
             'cv', round(coalesce((select h from ht where ht.dia = k.dia and ht.turno = k.turno and ht.m = 'CV07'), 0)::numeric, 2),
             'avd', round(coalesce((select h from hj where hj.dia = k.dia and hj.turno = k.turno and hj.m = 'AV10'), 0)::numeric, 2),
             'cvd', round(coalesce((select h from hj where hj.dia = k.dia and hj.turno = k.turno and hj.m = 'CV07'), 0)::numeric, 2),
             'tp', coalesce(pl.t_bm10, 0), 'tf', coalesce(pl.t_finos, 0)
           ) order by k.dia, k.turno)
      from k left join tu on tu.dia = k.dia and tu.turno = k.turno
             left join pl on pl.dia = k.dia and pl.turno = k.turno), '[]'::json);
end $function$;

revoke all on function public.efi_dados(date, date) from public;
grant execute on function public.efi_dados(date, date) to authenticated;
