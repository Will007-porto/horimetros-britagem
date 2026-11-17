# Horímetros · Britagem

Painel web da britagem (Tripoloni Construtora): status dos motores em tempo real, horímetros, aproveitamento por turno, Gantt diário de operação e paradas com justificativa.

Site estático (um `index.html`) que lê o **Supabase** direto do navegador. Hospedado na **Vercel** (cada push na `main` publica sozinho): https://horimetros-britagem.vercel.app

É o **painel do supervisor no computador**; o **APK Paradas Britagem** (repositório `APP-JUSTIFICATIVA-BRITAGEM`) é a ferramenta do operador. Os dois usam o mesmo banco, o mesmo login e os mesmos motivos.

## Como funciona

```
ESP32 (placa HF006-01) ──► Edge Function bright-api ──► tabela eventos (liga/desliga)
                                   │
         pg_cron (1/min) ──► /scan ┴─► detecta paradas ──► tabela eventos_parada ◄── APK dos operadores
                                                                   ▲
Site (Vercel, exige login) ── leitura: painel_* ───────────────────┤
                            ├─ justificar/corrigir: app_justificar, app_corrigir_justificativa
                            ├─ validar: app_fila_validacao, app_confirmar_manutencao
                            └─ equipe: app_supervisor_*, Edge Function admin-usuarios
```

- **Login obrigatório**, o mesmo do aplicativo: **nome + PIN de 6 dígitos** (por baixo, `nome@operador.paradas-britagem.app`). Sem login, ou sem liberação do supervisor (`usuarios_painel`), o site não mostra nenhum dado.
- **Paradas:** justifica qualquer data (supervisor), em lote, com os **mesmos motivos do app** (`motivos_parada`, filtrados por setor e equipamento). Corrigir uma parada já justificada exige observação e fica no histórico.
- **Validar** (manutenção e supervisor): paradas de manutenção (classe A) esperando confirmação; a manutenção confirma ou contesta, o supervisor mantém ou corrige.
- **Equipe** (supervisor): cadastrar usuário, trocar PIN, liberar, mudar papel/área, desativar ou apagar (o histórico de paradas é mantido; não dá para apagar a si mesmo nem o último supervisor). Cadastro e PIN passam pela Edge Function `admin-usuarios`, que confere no servidor se quem pede é supervisor (a chave de serviço nunca vai para o navegador).
- **Histórico:** toda mudança de justificativa (app, site ou sistema) fica em `eventos_parada_historico`, que não pode ser apagado nem editado.
- A placa só fala com o banco pela `bright-api` (v7): aceita dados só da placa e dos motores cadastrados; as rotas antigas do app de teste estão desativadas. Nenhuma tabela aceita escrita pela chave pública.

## Turnos (premissa de todo o cálculo)

Configurados nas tabelas `turnos_config` e `pausas_config`. Para mudar um horário, edite a tabela: o scanner e o site passam a usar na hora.

| Dia | 1º turno | 2º turno | Pausas (não contam como parada) |
|---|---|---|---|
| Seg a sex | 07:30–18:30 | 18:30–04:00 | almoço 12:30–13:30 · janta 21:00–22:00 |
| Sábado | 07:30–16:00 | 16:00–23:00 | almoço 12:30–13:30 · janta 19:00–20:00 |
| Domingo | 07:30–16:00 *(só se algum motor ligar)* | — | almoço 12:30–13:30 |

A função `janelas_produtivas(desde, ate)` devolve os horários produtivos (turno menos pausas) e é a fonte única de verdade.

**Regras de parada** (AV10 · Primário e CV07 · Secundário):
- conta só dentro das janelas produtivas;
- abre quando o motor fica desligado por **5 min (AV10)** ou **3 min (CV07)**;
- fecha no religamento ou no fim da janela (início de pausa ou fim do turno). Se continuar parado depois da pausa, abre uma nova.

**Aproveitamento** = horas rodando dentro dos turnos ÷ horas disponíveis (turno menos pausas). Não há meta cadastrada ainda.

## Dar acesso (usuários)

Pelo próprio site, entrando como **supervisor**: aba **Equipe → Novo usuário** (nome, PIN de 6 dígitos, papel e área).
A pessoa entra no app e no site com esse nome e PIN. Na mesma aba: trocar PIN, mudar papel/área e desativar.

Recomendado: em **Authentication → Sign In / Providers**, desligar *Allow new users to sign up* e ativar CAPTCHA.
Mesmo ligado, quem se cadastrar sozinho não vê nada (não está liberado em `usuarios_painel`).

## Estrutura

```
index.html                         site completo (HTML + CSS + JS)
producao.js / producao.css         aba Produção (acompanhamento diário)
producao-rel.js                    exportar relatório no modelo da planilha (PDF)
assets/                            logos
supabase/functions/bright-api/     Edge Function (placa, APK, scanner de paradas)
supabase/migrations/               SQL das tabelas, funções e permissões
```

## Publicar alterações

- **Site:** edite `index.html` e faça push na `main`. O GitHub Pages atualiza em ~1 minuto.
- **Edge Functions** (precisa da Supabase CLI):
  - `supabase functions deploy bright-api --no-verify-jwt` (a placa não envia login; a função valida placa e motor cadastrados)
  - `supabase functions deploy admin-usuarios` (exige login; confere supervisor no servidor)
  - Placa nova: cadastre o `id` na tabela `placas` antes de ligar, senão a `bright-api` recusa os dados (403).
- **Banco:** rode os arquivos de `supabase/migrations/` no SQL Editor, na ordem.

## Histórico

- **14/11/2026** — reconstrução: tabelas `leituras`, `dispositivos` e `notificacoes_push` recriadas (tinham sido apagadas e derrubaram a detecção de paradas desde 01/10); scanner reescrito com fechamento por janela; turnos reais em tabela; paradas de 01/10 a 14/11 recalculadas a partir dos eventos (antes de 01/11 marcadas como *histórico*); site publicado com login para justificar e escrita pública do banco fechada.

- **16/11/2026** — segurança (bright-api v7: só placa/motores cadastrados, rotas do app de teste desativadas; dados só para usuários liberados; auditoria imutável). Site virou o painel do supervisor: login com nome + PIN do app, justificativa com os motivos do app (por setor) e em lote, abas **Validar** e **Equipe** (cadastro e troca de PIN pela função `admin-usuarios`), histórico de cada parada. Ver `supabase/migrations/20261116_INDICE.md`.

- **17/11/2026** — aba **Produção** (acompanhamento diário com metas, lançamento por turno, curva S e relatório do dia), substituindo a planilha; histórico de set–nov importado. Aba **App (teste)** para testar o app antes do APK. Botão de **tema claro/escuro** no topo; linha de tendência e exportação do relatório no modelo da planilha.

## Produção: acompanhamento diário

Aba **Produção** substitui a planilha `ACOMPANHAMENTO_DIÁRIO_DA_PRODUÇÃO_BRITAGEM_IRATI.xlsx`. Todo usuário liberado vê; só o supervisor lança e muda metas.

- **Metas do mês:** meta por material (rachão dividido em obra Irati e Palmeira), calendário com dias **X** (cheio) e **XX** (sábado, peso 73,69%) e a parte do BM10 na meta de rachão (padrão 50%).
- **Lançar produção:** um dia por vez, toneladas por turno; rachão separado em BM10 e BMM05. Aceita contas como na planilha (`34*25`, `1934-1239+700`). Campo vazio = sem lançamento.
- **Painel:** programado, realizado, aderência ao previsto, saldo, por material, produção do dia com as paradas do dia, ritmo (média feita × necessária), curva S, barras por dia, rachão por equipamento e comparativo dos meses.
- **Relatório do dia:** botão na caixa "Produção do dia"; imprime em A4 (ou salva em PDF) com produção, acumulado do mês e as paradas do dia.
- **Exportar relatório:** botão no topo da aba; gera as 5 páginas do modelo da planilha (A4 deitado: visão geral, ritmo + curvas S, memória diária, rachão por equipamento e evolução) até o dia escolhido. Na janela de impressão, escolha **Salvar como PDF**; o nome já vem `PRODUÇÃO dd.mm`.
- **Linha de tendência:** botão na curva S; projeta o fim do mês mantendo o ritmo já feito (toneladas por dia programado, sábado com o peso dele). Também aparece no relatório exportado quando está ligada.
- Meta do dia = meta do mês × peso do dia ÷ soma dos pesos. O calendário é um só para todos os materiais.
- Banco: `supabase/migrations/20261117_producao_britagem.sql`. Setembro a novembro/2026 importados da planilha.

## App (teste): ambiente de teste do app de apontamentos

A aba **App (teste)** (só supervisor) roda a próxima versão do app `APP-JUSTIFICATIVA-BRITAGEM`
dentro do site, em `/app/`, **com os dados reais** e login separado do painel. Fluxo:

1. Mudança no app → commit no repositório do app.
2. Gerar a versão de teste: `npm run build:teste` (gera `dist-teste/` com base `/app/`, faixa
   "VERSÃO DE TESTE" e sessão própria via `.env.teste`).
3. Copiar `dist-teste/` para a pasta `app/` deste site e atualizar `app/versao.json`
   (versão + commit do app + data) → publicar o site.
4. Testar na aba **App (teste)**.
5. Aprovado → publicar o app no GitHub (AI Studio puxa) e gerar o APK com o mesmo commit.
