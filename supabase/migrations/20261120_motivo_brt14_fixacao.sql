-- Motivo novo para os cones HP (RC15, RC17): quebra de pino ou parafuso de fixação
-- (carcaça, base, tampa, proteção). Grupo QUEBROU, classe A (falha), indicador calculado pelo banco, a manutenção confirma.
insert into public.motivos_parada (codigo, nome_operador, grupo, classe, aplica_a, confirma, ordem, ativo)
values ('BRT-14', 'Parafuso / pino de fixação quebrou', 'QUEBROU', 'A', array['RC15','RC17'], 'MANUTENCAO', 17, true)
on conflict (codigo) do update set nome_operador = excluded.nome_operador, grupo = excluded.grupo, classe = excluded.classe,
  aplica_a = excluded.aplica_a, confirma = excluded.confirma, ordem = excluded.ordem, ativo = true;
