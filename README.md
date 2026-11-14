# Horímetros · Britagem

Painel web da britagem (Tripoloni Construtora): status dos motores em tempo real, horímetros, aproveitamento por turno, Gantt diário de operação e paradas com justificativa.

Site estático (um `index.html`) que lê o **Supabase** direto do navegador. Hospedado no **GitHub Pages**.

## Como funciona

```
ESP32 (placa HF006-01) ──► Edge Function bright-api ──► tabela eventos (liga/desliga)
                                   │
         pg_cron (1/min) ──► /scan ┴─► detecta paradas ──► tabela eventos_parada ◄── APK dos operadores
                                                                   ▲
Site (GitHub Pages) ── leitura: funções painel_* ──────────────────┤
                    └─ justificar: painel_justificar (exige login) ┘
```

- **Leitura** é pública: o site usa a chave *publishable* do Supabase (feita para ficar no navegador) e só chama funções de leitura (`painel_dados`, `painel_gantt`, `painel_paradas`).
- **Justificar** exige login (Supabase Auth) **e** o usuário cadastrado na tabela `usuarios_painel`. O nome de quem justificou é gravado automaticamente.
- O APK e a placa só falam com o banco pela Edge Function `bright-api` (chave de serviço). Nenhuma tabela aceita escrita pela chave pública.

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

## Dar acesso para justificar

1. Supabase → **Authentication → Users → Add user**: e-mail e senha, marque *Auto confirm*.
2. Copie o **UID** do usuário criado e rode no SQL Editor:
   ```sql
   insert into public.usuarios_painel (user_id, nome) values ('UID-AQUI', 'Nome da pessoa');
   ```
3. Para tirar o acesso: `update public.usuarios_painel set ativo = false where nome = 'Nome da pessoa';`

Recomendado: em **Authentication → Sign In / Providers**, desligar *Allow new users to sign up*. Mesmo ligado, quem se cadastrar sozinho não consegue justificar (não está em `usuarios_painel`).

## Estrutura

```
index.html                         site completo (HTML + CSS + JS)
assets/                            logos
supabase/functions/bright-api/     Edge Function (placa, APK, scanner de paradas)
supabase/migrations/               SQL das tabelas, funções e permissões
```

## Publicar alterações

- **Site:** edite `index.html` e faça push na `main`. O GitHub Pages atualiza em ~1 minuto.
- **Edge Function:** `supabase functions deploy bright-api --no-verify-jwt` (precisa da Supabase CLI).
- **Banco:** rode os arquivos de `supabase/migrations/` no SQL Editor, na ordem.

## Histórico

- **14/11/2026** — reconstrução: tabelas `leituras`, `dispositivos` e `notificacoes_push` recriadas (tinham sido apagadas e derrubaram a detecção de paradas desde 01/10); scanner reescrito com fechamento por janela; turnos reais em tabela; paradas de 01/10 a 14/11 recalculadas a partir dos eventos (antes de 01/11 marcadas como *histórico*); site publicado com login para justificar e escrita pública do banco fechada.
