-- Acompanhamento diário da produção (aplicada em 17/11/2026 como "producao_britagem")
-- Substitui a planilha ACOMPANHAMENTO_DIÁRIO_DA_PRODUÇÃO_BRITAGEM_IRATI.xlsx (abas mensais, CONFIG e dashboards).
-- Setembro, outubro e novembro/2026 foram importados da planilha (totais conferidos por material).
--
-- producao_mes   meta mensal por material. Rachão = meta_rachao_irati + meta_rachao_palmeira.
--                peso_sabado (padrão 0,7369, o da planilha) e pct_bm10 (parte do BM10 na meta de rachão).
-- producao_dia   calendário: X = dia cheio, XX = sábado. Sem linha = sem produção programada.
-- producao_lanc  toneladas por dia, turno (1/2) e material; rachão separado em BM10 e BMM05.
--
-- Meta do dia = meta do mês × peso do dia ÷ soma dos pesos (X = 1, XX = peso_sabado).
--
-- Segurança: RLS ligado; leitura só para usuário liberado (app_usuario_ativo); escrita direta revogada.
-- Funções:
--   prod_dados(p_mes date)                    → json {mes, dias, lanc, meses, ultimo_dia}; exige usuário liberado
--   prod_salvar_dia(p_dia date, p_itens jsonb) → só supervisor; item {turno, material, equipamento, t}; t nulo apaga
--   prod_salvar_mes(p_mes, metas..., p_peso_sabado, p_pct_bm10, p_dias jsonb) → só supervisor; regrava o calendário do mês
-- Erros: nao_autorizado, dia_no_futuro, itens_invalidos, toneladas_invalidas, meta_invalida, peso_invalido,
--        pct_invalido, dias_invalidos, dia_fora_do_mes.

create table public.producao_mes (
  mes date primary key check (extract(day from mes) = 1),
  meta_rachao_irati numeric not null default 0 check (meta_rachao_irati >= 0),
  meta_rachao_palmeira numeric not null default 0 check (meta_rachao_palmeira >= 0),
  meta_brita01 numeric not null default 0 check (meta_brita01 >= 0),
  meta_po numeric not null default 0 check (meta_po >= 0),
  meta_brita02 numeric not null default 0 check (meta_brita02 >= 0),
  peso_sabado numeric not null default 0.7369 check (peso_sabado > 0 and peso_sabado <= 1),
  pct_bm10 numeric not null default 0.5 check (pct_bm10 >= 0 and pct_bm10 <= 1),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null
);

create table public.producao_dia (
  dia date primary key,
  tipo text not null check (tipo in ('X','XX'))
);

create table public.producao_lanc (
  dia date not null,
  turno smallint not null check (turno in (1,2)),
  material text not null check (material in ('RACHAO','BRITA01','PO','BRITA02')),
  equipamento text not null default '-' check (equipamento in ('-','BM10','BMM05')),
  toneladas numeric not null check (toneladas >= 0 and toneladas <= 50000),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  primary key (dia, turno, material, equipamento),
  check ((material = 'RACHAO') = (equipamento <> '-'))
);

alter table public.producao_mes enable row level security;
alter table public.producao_dia enable row level security;
alter table public.producao_lanc enable row level security;
create policy "leitura usuarios liberados" on public.producao_mes for select to authenticated using ((select app_usuario_ativo()));
create policy "leitura usuarios liberados" on public.producao_dia for select to authenticated using ((select app_usuario_ativo()));
create policy "leitura usuarios liberados" on public.producao_lanc for select to authenticated using ((select app_usuario_ativo()));
revoke all on public.producao_mes, public.producao_dia, public.producao_lanc from anon;
revoke insert, update, delete on public.producao_mes, public.producao_dia, public.producao_lanc from authenticated;

-- Corpo completo das funções: ver no banco (pg_get_functiondef('public.prod_dados'::regproc) etc.).
