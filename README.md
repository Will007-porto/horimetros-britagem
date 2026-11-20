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

**Dia de produção:** o dia D vai de D 07:30 até D+1 07:30. Os dois turnos do dia 13/11, por exemplo, vão de 13/11 07:30 até 14/11 04:00. Horas por dia, partidas, Gantt, filtro de período e paradas do dia usam essa regra (`dia_producao(ts)` e `inicio_dia_producao(dia)` no banco). O que rodar entre 04:00 e 07:30 conta como extra do dia anterior.

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
manifest.webmanifest, sw.js, icons/ aplicativo instalável (PWA)
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

- **17/11/2026** — aba **Produção** (acompanhamento diário com metas, lançamento por turno, curva S e relatório do dia), substituindo a planilha; histórico de set–nov importado. Aba **App (teste)** para testar o app antes do APK. Botão de **tema claro/escuro** no topo; **dia de produção 07:30 → 04:00** em todo o painel e **filtros refeitos** (período com setas, turno, equipamentos por área); linha de tendência e exportação do relatório no modelo da planilha.

## Dividir parada

Quando até um horário foi um motivo e depois foi outro: botão **Dividir** na tabela de Paradas, ou **Dividir esta parada** na janela de justificativa (também aberta clicando na parada no Gantt).
- Escolha o horário pela régua ou digitando a hora (entende passagem da meia-noite). A tela mostra as duas partes com a duração.
- A 1ª parte fica com a justificativa atual; a 2ª nasce sem justificativa e abre em seguida para justificar. Parada aberta: a 2ª parte continua aberta até a máquina religar.
- Mesma regra do app (`app_fracionar_parada`): supervisor divide qualquer uma; operador só no seu turno e setor; manutenção não divide. Mínimo de 2 min depois do início e 1 min antes do fim. Fica registrado no histórico ("Dividiu a parada").

## Gantt diário

- Mostra o dia de produção inteiro (07:30 → 07:30), com as faixas dos turnos e pausas.
- **Filtro de turno**: o eixo mostra só a janela do turno escolhido (1º 07:30 → 18:30, 2º 18:30 → 04:00; sábado 07:30 → 16:00 e 16:00 → 23:00) e horas, aproveitamento e paradas contam só dentro dela.
- **Paradas** aparecem só nas linhas de **AV10** e **CV07** (os motores que o scanner monitora): vermelho cheio = justificada, hachurado = sem justificativa, contorno tracejado = em andamento. Clicar numa parada abre a justificativa.

## Aplicativo (PWA)

O painel pode ser instalado no celular ou no computador como aplicativo (ícone "Britagem").
- **Android / Chrome / Edge:** botão **Instalar app** no topo (ou menu do navegador → Instalar app).
- **iPhone (Safari):** Compartilhar → **Adicionar à Tela de Início** (o botão Instalar explica).
- Atalhos do ícone (segurar o ícone no Android): Produção, Paradas e Gantt (`/?aba=prd`, `par`, `gan`).
- `sw.js`: telas do painel com rede primeiro (sempre a versão nova quando há internet; sem internet abre a última guardada); bibliotecas da CDN guardadas; **Supabase e `/app/` nunca passam pelo cache**.
- Versão nova do `sw.js` não assume sozinha: aparece o aviso "Nova versão do painel disponível" e só recarrega quando o usuário toca em **Atualizar** (uma vez só). Ao mudar `sw.js`, troque a constante `VERSAO`.
- Ícones em `icons/` (símbolo da Tripoloni sobre o azul do painel), `manifest.webmanifest` na raiz.

## Abertura rápida

- Consulta principal (`painel_dados`) em ~0,2 s (era ~4,2 s): ver `supabase/migrations/20261119_painel_dados_rapido.sql`.
- O painel guarda a última leitura no aparelho (`hb_cache_v1`, presa ao usuário logado, válida por 7 dias): ao abrir, mostra na hora e atualiza por trás ("Atualizando…" no topo). Apagada ao sair ou se o login for recusado.
- Os dados são pedidos junto com a conferência do login (em paralelo), e as conexões com o banco e a CDN são abertas antes (preconnect).
- Carregamento sem texto técnico: esqueleto com o formato do painel.

## Atualização automática (sem recarregar)

- O site nunca recarrega a página sozinho. Os dados chegam pelo **Supabase Realtime** (paradas, produção e status das máquinas) e, de reserva, a cada **60 s** com a aba visível.
- A atualização troca só os números: não volta ao topo, não refaz animação, não apaga filtro nem seleção.
- Aba escondida: o tempo real desliga; ao voltar, atualiza na hora.
- Com formulário aberto ou campo em edição, a atualização espera. Se o registro aberto for alterado por outra pessoa, aparece um aviso no formulário (nada é substituído).
- No topo: "Atualizado há X" ("ao vivo" quando o tempo real está conectado) e o botão **Atualizar**, que busca de novo sem recarregar.

## Produção: acompanhamento diário

Aba **Produção** substitui a planilha `ACOMPANHAMENTO_DIÁRIO_DA_PRODUÇÃO_BRITAGEM_IRATI.xlsx`. Todo usuário liberado vê; só o supervisor lança e muda metas.

- **Metas do mês:** meta por material (rachão dividido em obra Irati e Palmeira), calendário com dias **X** (cheio) e **XX** (sábado, peso 73,69%) e a parte do BM10 na meta de rachão (padrão 50%).
- **Lançar produção:** um dia por vez, toneladas por turno; rachão separado em BM10 e BMM05. Aceita contas como na planilha (`34*25`, `1934-1239+700`). Campo vazio = sem lançamento.
- **Painel:** programado, realizado, aderência ao previsto, saldo, por material, produção do dia com as paradas do dia, ritmo (média feita × necessária), curva S, barras por dia, rachão por equipamento e comparativo dos meses.
- **Relatório do dia:** botão na caixa "Produção do dia"; imprime em A4 (ou salva em PDF) com produção, acumulado do mês e as paradas do dia.
- **Exportar produção:** botão no topo da aba; gera as 5 páginas do modelo da planilha (A4 deitado: visão geral, ritmo + curvas S, memória diária, rachão por equipamento e evolução) até o dia escolhido. Na janela de impressão, escolha **Salvar como PDF**; o nome já vem `PRODUÇÃO dd.mm`.
- **Produção por dia com filtro:** Total ou um material (meta do material e % de atendimento em cada dia); no Rachão, Os dois / BM10 / BMM05 com a parte de cada equipamento na meta.
- **Visão do total (seletor no topo da aba):** **Estoque** (padrão; o que foi produzido de fato, sem contar os finos duas vezes) = realizado é o **britado** (rachão do BM10 + BMM05) e a **meta do britado = meta de rachão para uso + rachão para os finos**. 1 t de rachão vira os três finos ao mesmo tempo, no **mix das balanças** (fração de cada fino no total de finos, média ponderada de todo o histórico, calculada pelo `prod_dados`); por isso o rachão para os finos é o do material mais exigente (meta ÷ mix, o gargalo), e o excedente dos outros vai para o estoque. Por equipamento, o rachão para os finos vai todo para o BM10 e o BMM05 fica com a parte dele da meta de rachão. **Produtividade** = o que passou em cada etapa da planta (soma rachão + finos, como a planilha antiga). No gráfico de barras por dia, a visão Estoque empilha por destino: rachão que foi para o estoque (britado − finos) + Brita 01 + Pó + Brita 02, com a altura total igual ao britado. Indicadores, curva S, ritmo, tendência, produção do dia, gráfico por dia, tabelas, comparativo dos meses e o PDF de produção seguem a visão escolhida.
- **Toneladas por hora trabalhada (só na visão Produtividade):** primário = rachão lançado no BM10 ÷ horas ligado do **AV10**; secundário = Brita 01 + Pó + Brita 02 ÷ horas ligado do **CV07**. As horas vêm do `prod_dados` (campo `horas`, por dia de produção 07:30 → 07:30, intervalos ligados acima de 16h cortados, mesma regra do mapa de operação). Só entram na conta os dias com produção lançada **e** horas registradas. Mostra t/h do mês, horas, toneladas, R² (quanto das toneladas as horas explicam), barras de t/h por dia (verde acima e laranja abaixo da média do mês, linha tracejada = média; escala até 2× a média) e marca como **fora do padrão** os dias acima de 1,5× ou abaixo da metade da média (geralmente hora perdida pelo sensor ou lançamento trocado).
- **Saldo de material:** caixa na aba Produção (diagrama de Sankey) e botão **Exportar saldo** (PDF, 2 páginas). Regra: o **rachão do BM10 lançado é tudo o que o BM10 britou**; os **finos** do secundário (Brita 01, Pó, Brita 02) **saem de dentro dele**; a **sobra vai para o estoque de rachão**, junto com o BMM05. Britado total = rachão do BM10 + BMM05. Se num dia os finos passam do rachão britado, a sobra fica negativa: o secundário consumiu estoque anterior.
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
