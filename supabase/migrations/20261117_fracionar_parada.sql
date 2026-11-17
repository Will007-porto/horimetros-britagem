-- Separar a parada quando o motivo muda (aplicada em 17/11/2026 como "fracionar_parada")
--
-- app_fracionar_parada(p_id text, p_quando timestamptz default now())
--   Divide a parada em duas no instante p_quando:
--   - a 1ª parte termina em p_quando e mantém a justificativa que já tinha
--   - a 2ª parte começa em p_quando, nasce pendente e, se a parada ainda está aberta,
--     continua aberta: a bright-api (/scan) fecha quando a máquina religar
--   Regras: mesmas de app_justificar para área e turno (operador só no próprio turno;
--   supervisor livre; manutenção não pode). Mínimo de 2 min depois do início (e 1 min antes
--   do fim, se fechada). Recusa se a máquina já religou entre o início e p_quando.
--   Registra "FRACIONOU" em eventos_parada_historico nas duas partes.
--   Id da parte nova: evt-<motor>-<epoch ms>, igual ao padrão da API.

alter table public.eventos_parada_historico drop constraint if exists eventos_parada_historico_acao_check;
alter table public.eventos_parada_historico add constraint eventos_parada_historico_acao_check
  check (acao = any (array['CONFIRMOU','CONTESTOU','CORRIGIU','JUSTIFICOU','ALTEROU','FRACIONOU']));

-- Corpo completo da função: ver no banco (pg_get_functiondef('public.app_fracionar_parada'::regproc)).
