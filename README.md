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
- **Equipe** (supervisor): cadastrar usuário, trocar PIN, liberar, mudar papel/área, desativar. Cadastro e PIN passam pela Edge Function `admin-usuarios`, que confere no servidor se quem pede é supervisor (a chave de serviço nunca vai para o navegador).
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
