-- Painel atualiza sem recarregar (aplicada em 17/11/2026 como "realtime_painel")
-- O site escuta estas tabelas pelo Supabase Realtime e, quando muda algo, busca os dados de novo
-- sem recarregar a página. "maquinas" já estava na publicação. A leitura continua presa ao RLS.
alter publication supabase_realtime add table public.eventos_parada, public.producao_lanc, public.producao_mes, public.producao_dia;
