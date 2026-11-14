# Resumo da sessão: Horímetros Britagem

> Sessão de 14/11/2026 (sábado). Sem chaves nem senhas neste arquivo: as credenciais ficam no Supabase, na Vercel e no GitHub.

---

## 1. Objetivo

Construir um **site/painel web** para os horímetros da britagem (Tripoloni Construtora), no padrão visual do arquivo de referência *Resumo – Mão de Obra e Equipamentos* (sidebar com a marca, KPIs, caixas que recolhem, gráficos em SVG, impressão em A3). O painel usa os dados do projeto Supabase **HORIMETROS BRITAGEM**.

O escopo cresceu ao longo da sessão:
1. Painel de leitura: status, horímetros, Gantt diário, paradas.
2. Filtros no padrão de um site profissional.
3. Sistema de **justificativa de paradas**.
4. Correção do sistema de detecção de paradas, que estava quebrado desde 01/10.
5. Modelagem dos **turnos reais** da britagem.
6. Publicação como site de verdade (GitHub + Vercel).
7. Análise da árvore de motivos de parada (em andamento).

---

## 2. Infraestrutura e endereços

| Item | Valor |
|---|---|
| Projeto Supabase | `HORIMETROS BRITAGEM`, ref `mygzyalhxlpsutbdauhp`, região `us-east-1`, Postgres 17 |
| URL do Supabase | `https://mygzyalhxlpsutbdauhp.supabase.co` |
| Chave usada no site | **publishable** (`sb_publishable_…`), pública por design: o que ela pode fazer é limitado pelas permissões do banco |
| Repositório | `https://github.com/Will007-porto/horimetros-britagem` (**público**, branch `main`) |
| Site em produção | **https://horimetros-britagem.vercel.app** |
| Projeto Vercel | `will007-portos-projects/horimetros-britagem`, ligado ao GitHub: **cada push no `main` publica sozinho** |
| Edge Function | `bright-api`, versão **23** (`bridge-v6-janelas-produtivas`), `verify_jwt = false` |
| Agendamentos (`pg_cron`) | job 1: `* * * * *` → `POST /functions/v1/bright-api/scan` · job 2: `* * * * *` → `select public.sync_paradas_eventos()` (sistema legado, ver pendências) |
| Placa IoT | `HF006-01` (ESP32), envia liga/desliga para a `bright-api` |
| App dos operadores | APK Android `com.britagem.irati`, com push via Firebase (FCM) |
| Painel antigo (obsoleto) | artifact no claude.ai, que lia o banco pelo conector MCP do Supabase. Substituído pelo site da Vercel |

**Motores** (tabela `maquinas`): `AV10` (Primário, alimentador), `BM10`, `CV07` (Secundário), `PV20`, `PV22`, `RC15`, `RC17`. Só **AV10** e **CV07** são monitorados para paradas.

---

## 3. Estrutura do repositório

```
index.html                                        site completo (HTML + CSS + JS, ~100 KB)
assets/logo-branco.png                            logo para fundo escuro (sidebar)
assets/logo-azul.png                              logo para impressão e favicon
README.md                                         documentação de uso e operação
RESUMO_SESSAO.md                                  este arquivo
.nojekyll                                         (sobra da tentativa com GitHub Pages)
.gitignore                                        .vercel, .env*  (criado pela CLI da Vercel)
supabase/functions/bright-api/index.ts            Edge Function (placa, APK, scanner)
supabase/migrations/20261114_01_recriar_tabelas_scanner.sql
supabase/migrations/20261114_02_turnos_e_pausas.sql
supabase/migrations/20261114_03_site_e_seguranca.sql
```

Commits no `main`: `b4c6ab9` (site, função e migrations), `87dacf0` (`.gitignore` da Vercel).

---

## 4. Banco de dados (Supabase)

### 4.1 Tabelas existentes (antes da sessão)

| Tabela | Uso |
|---|---|
| `eventos` | liga/desliga bruto por motor (`placa_id`, `motor_id`, `estado` ligado/desligado, `timestamp`, `id_evento`). Cerca de 13 mil linhas desde 04/08 |
| `maquinas` | `id`, `nome`, `horas_acumuladas`, `ultimo_estado`, `ultima_atualizacao`, `meta_horas_turno` (8, valor padrão sem uso real) |
| `placas` | `id`, `ultima_atualizacao` (heartbeat da placa) |
| `eventos_parada` | **sistema oficial de paradas** (o mesmo do APK): `id` (texto `evt-<motor>-<epoch_ms>`), `motor`, `estagio`, `inicio_parada`, `fim_parada`, `status` (`pendente` / `aguardando_justificativa` / `justificado`), `tipo` (`nao_programada` / `programada`), `categoria`, `justificativa_texto`, `justificado_por`, `justificado_em`, `duracao_minutos` |
| `paradas_arvore` | árvore de motivos: `area` (PRIMARIO/SECUNDARIO) → `nivel` CLASSIFICACAO → MOTIVO (`parent_id`). 11 classificações, 110 motivos |
| `paradas_eventos`, `paradas_motivos`, `paradas_equipamentos`, `paradas_config` | **sistema paralelo/legado**, sem uso. `paradas_equipamentos` ainda serve para os nomes de exibição (AV10 = Primário, CV07 = Secundário) |
| `paradas`, `tarefas` | vazias |

### 4.2 Tabelas criadas nesta sessão

| Tabela | Migration | Descrição |
|---|---|---|
| `leituras` | 01 | leituras ligou/desligou vindas do app (`motor`, `tipo`, `timestamp`). **Recriada**: tinha sido apagada |
| `dispositivos` | 01 | celulares registrados para push (`token_fcm` único, `operador_nome`, `app_id`, `ativo`). **Recriada** |
| `notificacoes_push` | 01 | controle de envio de push (`evento_id` + `token_fcm` únicos, `status`, `resposta`). **Recriada** |
| `turnos_config` | 02 | turnos por dia da semana (`dia_semana` ISO 1–7, `turno` 1/2, `inicio`, `fim`, `eventual`, `ativo`) |
| `pausas_config` | 02 | pausas programadas (`dia_semana`, `turno`, `nome`, `inicio`, `fim`, `ativo`) |
| `usuarios_painel` | 03 | quem pode justificar pelo site (`user_id` → `auth.users`, `nome`, `ativo`). **Vazia por enquanto** |

Índices criados: `leituras_motor_ts_idx`, `eventos_motor_estado_ts_idx`, `eventos_parada_aberta_idx` (parcial, `fim_parada is null`).

### 4.3 Configuração de turnos (premissa de todo o cálculo)

| Dia | 1º turno | 2º turno | Almoço (T1) | Janta (T2) |
|---|---|---|---|---|
| Seg a sex | 07:30–18:30 | 18:30–04:00 (+1 dia) | 12:30–13:30 | 21:00–22:00 |
| Sábado | 07:30–16:00 | 16:00–23:00 | 12:30–13:30 | **19:00–20:00** |
| Domingo | 07:30–16:00, **eventual** (só conta se algum motor ligar) | — | 12:30–13:30 | — |

Não há meta de produção definida (decisão do usuário). A coluna `maquinas.meta_horas_turno` não é usada.

### 4.4 Funções (RPC)

| Função | Tipo | Permissão | O que faz |
|---|---|---|---|
| `janelas_produtivas(p_desde, p_ate)` | SQL, stable | anon, authenticated, service_role | Devolve as janelas produtivas (turno menos pausas): `dia` (dia de produção), `turno`, `turno_inicio`, `turno_fim`, `inicio`, `fim`. **Fonte única de verdade** para o scanner, o site e os recálculos |
| `painel_dados()` | SQL, security definer | anon, authenticated | JSON principal do site: `gerado`, `hoje`, `maq`, `ult`, `placa`, `hd` (horas/dia de calendário), `jw` (janelas de 90 dias), `hj` (horas por motor/dia/turno dentro das janelas), `pt` (partidas), `ps` (resumo de paradas), `eqn`. Cerca de 65 KB |
| `painel_gantt(p_dia)` | SQL, security definer | anon, authenticated | Gantt de um **dia de produção, das 06h às 06h**: `seg` (intervalos ligados), `t0`, `jan` (janelas planejadas do dia) |
| `painel_paradas(p_desde, p_ate, p_pendentes)` | SQL, security definer | anon, authenticated | Paradas do período (ou todas as pendentes) mais a árvore de motivos ativa |
| `painel_eu()` | SQL, security definer | anon, authenticated | `{logado, nome, autorizado}` do usuário atual |
| `painel_justificar(p_ids, p_classificacao, p_motivo, p_tipo, p_texto)` | PL/pgSQL, security definer | **só authenticated** | Exige o usuário em `usuarios_painel` (ativo). Valida o motivo na árvore, o tipo, o tamanho do texto e a observação obrigatória para "Outro"/"Não sei". Grava `categoria = "Classificação › Motivo"` e `justificado_por` = nome do usuário |

Funções que já existiam: `claim_logical_stop(...)` (idempotência na criação de paradas, usada pela `bright-api`), `justificar_paradas(...)` e `sync_paradas_eventos()` (sistema legado).

### 4.5 Segurança (RLS e permissões)

Os logs de 24h mostraram que **100% do acesso REST vinha da Edge Function** (chave secreta). Com isso, a escrita pública foi fechada:
- `eventos_parada`: política `ALL public` removida → criada `leitura eventos_parada` (só SELECT)
- `placas`: removida `permite upsert placas`
- `eventos`: removida `permite insert de eventos`
- `tarefas`: removida `Permitir tudo para anon`
- `justificar_paradas` e `claim_logical_stop`: revogadas de anon/public, concedidas explicitamente a `service_role`
- `painel_justificar`: **revogada de anon explicitamente**, porque o Supabase concede EXECUTE ao anon por padrão em funções novas
- Tabelas novas com RLS ligado; `leituras`, `dispositivos`, `notificacoes_push` e `usuarios_painel` **sem políticas** (só a chave de serviço acessa)

---

## 5. Edge Function `bright-api` (`supabase/functions/bright-api/index.ts`)

Rotas (sem mudança, exceto o `/scan`):
- `GET /`, `/health` · `GET /leituras`, `/eventos`, `/maquinas`, `/placas`
- `POST /` (evento da placa, `firmwareEvent`) · `tipo: heartbeat` · `POST /dispositivos` · `POST /leituras` · `POST /eventos` · `POST /justificar` · **`POST /scan`**

**Scanner `/scan` reescrito** (`scanStopsInBackground`). Funções novas:
- `productiveWindows(fromMs, toMs)`: chama a RPC `janelas_produtivas`
- `windowContaining(windows, ms)`
- `latestReading(motor)`: último estado conhecido, de qualquer horário (`eventos` + `leituras`)
- `firstStartAfter(motor, iso)`: primeiro religamento após um instante

Regras:
1. **Fechamento (roda sempre, até fora do turno):** toda parada aberta fecha no **primeiro religamento** ou, se a janela acabar antes, no **fim da janela** (início da pausa ou fim do turno). Status `aguardando_justificativa`, preservando `justificado`.
2. **Abertura (só dentro de janela produtiva):** se o último estado é *desligou* e passou o limite (**AV10 = 5 min**, **CV07 = 3 min**), abre a parada em `max(desligamento, início da janela)`. Motor ligado desde antes do turno **não** gera parada falsa.
3. Depois de uma pausa, se o motor continua parado, nasce uma parada nova no fim da pausa.

Constantes: `MONITORED_MOTORS = {AV10, CV07}`, `STOP_THRESHOLDS_MINUTES = {AV10: 5, CV07: 3}`. Variáveis de ambiente usadas (nomes, sem valores): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_SERVICE_ACCOUNT` (ou `FIREBASE_SERVICE_ACCOUNT_JSON`), `FIREBASE_PROJECT_ID`.

Testes: 9 cenários num banco simulado (religamento, sexta → fim às 18:30, motor ligado sem parada falsa, abertura às 07:30, almoço fecha às 12:30 e reabre às 13:30, janta de sábado às 19:00, domingo sem operação), mais a validação em produção (respostas 200, parada real do CV07 criada às 08:52 de sábado).

---

## 6. Site (`index.html`)

Arquivo único (HTML + CSS + JS), com biblioteca `@supabase/supabase-js@2.45.4` (UMD, via jsDelivr) e fontes Inter + IBM Plex Mono.

**Configuração no código:** `SUPABASE_URL`, `SUPABASE_KEY` (publishable), cliente `sb`, função `rpc(fn, args)`.

**Abas:**
- **Visão geral:** status agora (ligado / desligado / sem sinal há mais de 24h), horas operadas, aproveitamento dos turnos, 3 leituras automáticas, horas por motor, horímetro acumulado.
- **Horímetros:** KPIs (horas, **aproveitamento**, partidas, horas no último dia), mapa de calor motor × dia (clicar abre o Gantt), **aproveitamento por turno**, horas por dia com linha de média, quadro de horímetros.
- **Gantt diário:** dia de produção das 06h às 06h, faixas de 1º e 2º turno e pausas, barras dos períodos ligados, botão "Unir pausas < 2 min", linha da hora da leitura, aproveitamento do dia.
- **Paradas:** KPIs, tempo parado por equipamento (aguardando / justificada / histórico), principais causas, lista com abas (Todas / Aguardando / Abertas / Justificadas / Histórico), colunas ordenáveis, coluna de turno, seleção em lote, opção "todas as pendentes de qualquer data", painel lateral de justificativa (tipo → classificação → motivo → observação; o nome de quem justificou vem do login).

**Filtros globais** (barra fixa, lembrados no `localStorage` com a chave `hb_f`):
- **Período:** atalhos (Hoje, Ontem, 7/30/90 dias, Este mês, Mês passado) ou intervalo personalizado (até 90 dias)
- **Ativos:** seleção múltipla com busca
- **Estado:** Todos / Ligados / Desligados / Sem sinal
- **Turno:** Ambos / 1º / 2º
- Etiquetas removíveis e contador

**Login:** botão "Entrar" (Supabase Auth, e-mail e senha). Ver o painel não exige login; justificar exige login **e** cadastro em `usuarios_painel`. A atualização automática roda a cada 2 min com a aba visível.

**Definições de cálculo:**
- Horas ligado = intervalos entre *ligado* e o próximo evento, **cortados em 16h** (intervalos maiores são placa sem sinal).
- **Aproveitamento** = horas rodando dentro das janelas ÷ horas disponíveis (turno menos pausas).
- "Sem sinal" = nenhum evento há mais de 24h.

**Testes:** navegador automatizado (desktop 1440 px e celular 390 px, modo claro e escuro) com Supabase simulado, mais um **teste em produção** na Vercel com o Supabase real (HTTP 200, dados em cerca de 2 s, nenhum erro no console).

---

## 7. Dados: correções aplicadas

1. **135 paradas abertas há semanas** (ago a out) foram fechadas no religamento real ou no fim do turno. O total parado caiu de 3.132h para 645h, sem noites e fins de semana.
2. **Recálculo de 01/10 a 14/11** a partir dos `eventos`, com as janelas produtivas certas: **687 paradas** inseridas (IDs no formato `evt-<motor>-<epoch_ms>`, compatível com o scanner).
3. Opção 2 escolhida pelo usuário, com **corte em 01/11**:
   - Pendentes antes de 01/11 viraram **histórico**: `status = 'justificado'`, `justificado_por = 'Sistema (histórico)'`, `categoria = 'Sem informação (histórico)'`. São 1.119 linhas, filtráveis para desfazer.
   - De 01/11 em diante ficaram como `aguardando_justificativa` (171 no último teste).
4. As **15 justificativas reais** (feitas pelo APK em agosto) foram preservadas.
5. No site, "Histórico" é uma situação separada e **não entra no % de justificadas**.

---

## 8. Problemas encontrados (e causa)

| Problema | Causa | Status |
|---|---|---|
| Nenhuma parada registrada de 01/10 a 14/11 | Tabelas `leituras`, `dispositivos` e `notificacoes_push` **apagadas**: a `bright-api` dava erro 500 (`PGRST205`) em todo turno, em silêncio | ✅ recriadas |
| `paradas_eventos` parada em 01/10 | A view `vw_paradas_av10_cv07` lê da própria `paradas_eventos`, em círculo, e o `sync_paradas_eventos()` só copia a tabela para ela mesma | ⚠️ sistema legado, não corrigido (sem uso) |
| Paradas abertas para sempre | O scanner antigo só olhava paradas do turno atual, então o que atravessava o fim do turno ficava órfão | ✅ corrigido na v22/v23 |
| Parada falsa às 07:30 com motor já ligado | Sem eventos no turno, a "política B" abria uma parada | ✅ usa o último estado conhecido |
| Turnos errados no código | O código tinha 07:30–18:00 / 19:30–05:00 e não tinha sábado | ✅ tabela `turnos_config` |
| Almoço e janta viravam parada | Não havia conceito de pausa | ✅ `pausas_config` e janelas produtivas |
| Escrita pública no banco | Políticas `ALL public` em `eventos_parada`, `tarefas`, `placas` e insert em `eventos` | ✅ fechado |
| Painel no claude.ai: erro "boundaries is not valid JSON" | O parser pegava a tag `<untrusted-data>` da frase de aviso | ✅ corrigido (e o painel saiu do claude.ai) |
| Horas com intervalos de até 127h | Placa sem sinal tratada como motor ligado | ✅ corte de 16h |
| `horas_acumuladas` ≠ soma dos eventos (ex.: AV10 752h × 881h) | Regras de cálculo diferentes entre a placa/função e os eventos brutos | ℹ️ o site mostra os dois, cada um rotulado |
| BM10 sem sinal desde 01/10 | Provável sensor ou placa | ⚠️ conferir em campo |
| Token `gh` da sessão inválido | Credencial da CLI do GitHub no ambiente | ℹ️ o repositório foi criado manualmente e o push foi pelo conector |

---

## 9. Árvore de motivos (`paradas_arvore`): análise feita, nada alterado

- **Estrutura íntegra:** sem órfãos, pais corretos, tudo ativo, criada de uma vez em 01/10 às 12:01. Primário: 5 classificações, 48 motivos. Secundário: 6 classificações (inclui Peneiramento), 62 motivos.
- **Problemas de conteúdo:**
  1. Mistura **causa × sintoma × ação**, então a mesma parada cabe em vários lugares. Exemplos: "Pedra ou material preso" × "Retirada de material preso" × "Destravamento"; "Sem material" × "Falta de material na frente" × "Material não está chegando".
  2. **18 de 110** motivos são "Outro" ou "Não sei" (16%).
  3. O tipo pode contradizer o motivo (**Não programada** + "Manutenção programada"). "Troca de turno" e "Pausa operacional" repetem o que as pausas configuradas já tratam.
  4. Faltam motivos usados pelo APK: **"Pedra Trancada / Embuchamento"** e **"Regulagem de Maquinário"**. Falta "parada em cadeia" no Primário e "falha elétrica" do equipamento.
  5. Códigos repetidos (`OUTRO` ×11, `NAO_SEI` ×7). A parada guarda o motivo **como texto**: se alguém renomear um motivo, o histórico se separa.
  6. **Bug no site:** a observação obrigatória vale para "Outro"/"Não sei", mas não para **"Não sei o que aconteceu"** (Equipamento). Isso vale tanto em `index.html` quanto em `painel_justificar`.
- **Momento ideal para reorganizar:** **nenhuma** parada foi justificada com a árvore ainda.

---

## 10. Decisões do usuário

- Sistema oficial de paradas: **`eventos_parada`** (o do APK), não `paradas_eventos`.
- Motivos pela **árvore** (`paradas_arvore`).
- Recriar as tabelas apagadas: **sim**. Corrigir o scanner e fechar as paradas abertas: **sim**.
- Paradas de 01/10 a 14/11: **reconstruir**, com antes de 01/11 marcadas como histórico.
- **Sem meta** de produção por enquanto.
- Site **funcionando** (não só versionamento), repositório **público**, hospedagem na **Vercel** (o GitHub Pages não foi ativado).

---

## 11. Pendências

**Para o usuário**
- [ ] **Criar os usuários que vão justificar:** Supabase → Authentication → Add user (*Auto confirm*), depois `insert into public.usuarios_painel (user_id, nome) values ('<UID>', '<Nome>');`. Hoje **ninguém** consegue justificar.
- [ ] Recomendado: desligar *Allow new users to sign up* no Supabase Auth.
- [ ] Fazer a **primeira justificativa real** pelo site e conferir se aparece no APK.
- [ ] Operadores devem **reabrir o APK** para registrar o celular (`dispositivos` está vazia, então nenhum push chega). O Firebase está configurado.
- [ ] Justificar as **171 paradas pendentes** desde 01/11.
- [ ] Confirmar os horários de refeição (sobretudo a **janta de sábado, 19:00–20:00**) e se todas as pausas são de 1h para as duas áreas.
- [ ] Decidir se a **partida do turno** (07:30 → cerca de 08:00, o arranque típico) é parada real ou preparação programada.
- [ ] Conferir em campo o **BM10**, sem sinal desde 01/10.

**Desenvolvimento**
- [ ] **Reorganizar a árvore de motivos** (proposta a ser revisada pela equipe antes de aplicar). Classificação = onde, motivo = causa. Um "Outro" por área. Tipo automático pelo motivo.
- [ ] Gravar o **ID do motivo** em `eventos_parada`, além do texto.
- [ ] Corrigir a observação obrigatória para **"Não sei o que aconteceu"** (no site e em `painel_justificar`), de preferência usando o código do motivo.
- [ ] Desativar ou remover o sistema legado: job 2 do `pg_cron` (`sync_paradas_eventos`), view `vw_paradas_av10_cv07`, tabelas `paradas_eventos`, `paradas_motivos`, `paradas_config`, `paradas`, `tarefas` (manter `paradas_equipamentos` ou levar os nomes para `maquinas`).
- [ ] **Alerta de saúde do scanner** (ex.: card no site quando a `bright-api` der erro ou ficar sem criar paradas), para não repetir as 6 semanas de falha silenciosa.
- [ ] Limpar o `.nojekyll` (sobra do GitHub Pages) e remover as funções `shiftContaining`/`makeServerShift` da `bright-api`, que não são mais usadas no scan.
- [ ] Opcional: conectar a Vercel como conector do claude.ai (o MCP da Vercel não conectou nesta sessão: `mcp.vercel.com` bloqueado e sem OAuth na nuvem).
- [ ] Reaplicar as migrations em ordem se for recriar o banco. As que foram aplicadas direto (ex.: `revogar_justificar_anon`) já estão incorporadas aos arquivos.

---

## 12. Ambiente da sessão (referência)

- Ambiente de nuvem pessoal **`horimetros-britagem`**, com rede liberada para: `vercel.com`, `api.vercel.com`, `horimetros-britagem.vercel.app`, `mygzyalhxlpsutbdauhp.supabase.co`, `cdn.jsdelivr.net`.
- CLI da Vercel 65.16.0 e plugin `vercel@claude-plugins-official` instalados **só neste container**, que é temporário. A integração GitHub ↔ Vercel é permanente.
