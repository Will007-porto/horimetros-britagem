-- Dia de produção (aplicada em 17/11/2026 como "dia_de_producao_0730")
-- O dia D vai de D 07:30 até D+1 07:30: 1º turno 07:30 → 18:30 e 2º turno 18:30 → 04:00 do dia seguinte
-- (sábado 07:30 → 16:00 e 16:00 → 23:00). Ex.: os dois turnos do dia 13/11 vão de 13/11 07:30 até 14/11 04:00.
-- O que rodar entre 04:00 e 07:30 conta como hora extra do dia anterior.
--
-- Antes: horas por dia, partidas e o filtro de paradas usavam o dia do calendário (00:00 → 24:00),
-- então o 2º turno depois da meia-noite caía no dia seguinte; o Gantt usava 06:00 → 06:00.
--
-- dia_producao(ts)          → o dia de produção de um instante
-- inicio_dia_producao(dia)  → D 07:30 (America/Sao_Paulo)
-- painel_dados: 'hoje' = dia de produção atual; 'hd' e 'pt' por dia de produção; novo 'eqb' {tag: [nome, area]}
-- painel_gantt: eixo de 07:30 a 07:30
-- painel_paradas(p_desde, p_ate): paradas que começaram entre p_desde 07:30 e (p_ate + 1) 07:30

create or replace function public.dia_producao(p_ts timestamptz)
 returns date language sql immutable set search_path to 'public'
as $$ select ((p_ts at time zone 'America/Sao_Paulo') - interval '7 hours 30 minutes')::date $$;

create or replace function public.inicio_dia_producao(p_dia date)
 returns timestamptz language sql immutable set search_path to 'public'
as $$ select (p_dia + time '07:30') at time zone 'America/Sao_Paulo' $$;

-- Corpo completo de painel_dados, painel_gantt e painel_paradas: ver no banco (pg_get_functiondef).
