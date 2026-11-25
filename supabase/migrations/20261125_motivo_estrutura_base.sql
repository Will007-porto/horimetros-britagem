-- Motivo de parada para reforço/reparo de estrutura ou base (ex.: bases do primário cedendo, nov/2026).
-- Falha de equipamento: classe A, conta na disponibilidade física, manutenção confirma (indicador DF é calculado pela classe). Vale para todos os equipamentos e áreas.
insert into public.motivos_parada (codigo, nome_operador, grupo, classe, aplica_a, confirma, ordem, ativo, areas)
values ('EST-01', 'Reforço / reparo de estrutura ou base', 'QUEBROU', 'A', null, 'MANUTENCAO', 6, true, null)
on conflict (codigo) do nothing;
