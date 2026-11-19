import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// bright-api v7 (segurança, 2026-11-16)
// - Ficam só as rotas usadas pela placa ESP32 (evento liga/desliga e heartbeat) e pelo cron (/scan).
// - Rotas do app Android de teste foram desativadas (justificar, eventos, leituras, dispositivos e
//   listagens): permitiam alterar justificativas e ler dados sem login.
// - Dados só são aceitos de placas e motores já cadastrados (tabelas placas e maquinas).
// - Evento com horário muito no futuro é recusado (travaria o estado do motor).
//
// bright-api v8 (horímetro da placa, 2026-11-19)
// - O horímetro de cada motor passa a vir da PLACA (heartbeat.estados[].horas_acumuladas).
//   A placa é a fonte da verdade: o valor informado no painel dela vale no Supabase.
// - Regra: o primeiro valor da placa assume o motor; depois, só sobe. Valor menor só entra
//   quando vem de um ajuste feito no painel (ajuste_id maior que o último aceito). Assim,
//   uma placa que volte zerada por falha não derruba o horímetro do Supabase.
// - O heartbeat NÃO mexe mais em ultimo_estado/ultima_atualizacao (relógio dos eventos).
// - Motor gerido pela placa não soma horas por par de eventos (evita contagem dupla).
// - Evento aceita "timestamp" ou "timestamp_evento" (firmware antigo só mandava o segundo,
//   e o servidor gravava a hora de chegada no lugar da hora real do evento).
//
// bright-api v9 (internet caiu, 2026-11-19)
// - Evento ATRASADO (mais antigo que o último estado do motor) agora é GUARDADO no histórico
//   (tabela eventos) em vez de descartado. Ele não mexe no estado atual nem no horímetro.
// - Evento atrasado ou chegando com mais de 5 min de atraso aciona reprocessar_paradas para o
//   período dele: as paradas que aconteceram durante a queda de internet são criadas na hora.
//   (Além disso, o cron 'britagem-reprocessar-paradas' roda a cada 10 min nas últimas 48 h.)
//
// Publicada no Supabase como versão 26 (verify_jwt = false: a placa não envia login).

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function pathOf(request: Request): string {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const marker = '/bright-api';
  const index = path.indexOf(marker);
  return index >= 0 ? path.slice(index + marker.length) || '/' : path || '/';
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  // Não usar request.json() diretamente: GET/OPTIONS/HEAD e chamadas incompletas podem não ter corpo.
  const raw = await request.text();
  if (raw.trim() === '') return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('o corpo deve ser um objeto JSON');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('corpo JSON inválido ou incompleto');
  }
}

const BRAZIL_TIME_ZONE_OFFSET = '-03:00';
const MAX_FUTURO_MS = 2 * 60 * 60 * 1000; // tolerância de relógio da placa
const ATRASO_REPROCESSA_MS = 5 * 60 * 1000; // evento chegando com mais de 5 min de atraso = veio de fila da placa
const REPROCESSA_MAX_MS = 30 * 24 * 60 * 60 * 1000; // a rotina aceita no máximo 31 dias

function timestampOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return new Date().toISOString();

  const raw = value.trim();
  const possuiFuso = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  const normalizado = possuiFuso ? raw : `${raw}${BRAZIL_TIME_ZONE_OFFSET}`;
  const date = new Date(normalizado);

  if (Number.isNaN(date.getTime())) throw new Error('timestamp inválido');
  if (date.getTime() > Date.now() + MAX_FUTURO_MS) throw new Error('timestamp no futuro');
  return date.toISOString();
}

function tipoLeituraOf(body: Record<string, unknown>): 'ligou' | 'desligou' | null {
  if (body.tipo === 'ligou' || body.tipo === 'desligou') return body.tipo;
  if (body.estado === 'ligado') return 'ligou';
  if (body.estado === 'desligado') return 'desligou';
  return null;
}

function dbError(error: { code?: string; message?: string }, operation: string): Response {
  console.error(`${operation}:`, error);
  return json({
    ok: false,
    error: 'database_error',
    operation,
    code: error.code ?? 'unknown',
    message: error.message ?? 'falha no banco',
  }, 500);
}

const MONITORED_MOTORS = new Set(['AV10', 'CV07']);
const STOP_THRESHOLDS_MINUTES: Record<string, number> = { AV10: 5, CV07: 3 };

// Refaz as paradas de AV10/CV07 desde 1 h antes do evento atrasado até agora.
// Falha aqui não pode derrubar o recebimento do evento: só registra no log (o cron de 10 min cobre).
async function reprocessarDesde(eventoMs: number): Promise<unknown> {
  const desdeMs = Math.max(eventoMs - 60 * 60 * 1000, Date.now() - REPROCESSA_MAX_MS);
  const { data, error } = await supabase.rpc('reprocessar_paradas', {
    p_desde: new Date(desdeMs).toISOString(),
    p_ate: new Date().toISOString(),
  });
  if (error) {
    console.error('reprocessar_paradas:', error);
    return null;
  }
  return data;
}

// Só placas já cadastradas podem enviar dados (cadastro de placa nova é feito no banco).
async function placaCadastrada(placaId: string): Promise<{ ok: boolean; erro?: Response }> {
  const { data, error } = await supabase.from('placas').select('id').eq('id', placaId).maybeSingle();
  if (error) return { ok: false, erro: dbError(error, 'verificacao_placa') };
  return { ok: Boolean(data) };
}

async function heartbeat(body: Record<string, unknown>): Promise<Response> {
  const placaId = body.placa_id;
  if (typeof placaId !== 'string' || !placaId.trim()) {
    return json({ ok: false, error: 'placa_id_obrigatorio' }, 400);
  }

  const placa = await placaCadastrada(placaId.trim());
  if (placa.erro) return placa.erro;
  if (!placa.ok) {
    console.warn('heartbeat de placa não cadastrada:', placaId);
    return json({ ok: false, error: 'placa_nao_cadastrada' }, 403);
  }

  const { error } = await supabase.from('placas').upsert({
    id: placaId.trim(),
    ultima_atualizacao: new Date().toISOString(),
  }, { onConflict: 'id' });

  if (error) return dbError(error, 'heartbeat');

  const estados = Array.isArray(body.estados) ? body.estados : [];
  let snapshotsAtualizados = 0;
  const horimetrosConfirmados: Array<{ motor_id: string; horas_acumuladas: number; motivo: string }> = [];
  const recusados: Array<{ motor_id: string; recebido: number; atual: number; motivo: string }> = [];
  const agora = new Date().toISOString();

  for (const item of estados) {
    if (!item || typeof item !== 'object') continue;
    const snapshot = item as Record<string, unknown>;
    const motorId = typeof snapshot.motor_id === 'string' ? snapshot.motor_id.trim() : '';
    const horasRecebidas = Number(snapshot.horas_acumuladas);
    const ajusteRecebido = Number(snapshot.ajuste_id ?? 0);
    if (!motorId || !Number.isFinite(horasRecebidas) || horasRecebidas < 0 || horasRecebidas > 1_000_000) continue;

    const { data: maquinaAtual, error: maquinaAtualError } = await supabase
      .from('maquinas')
      .select('horas_acumuladas, ajuste_id, horimetro_placa_em')
      .eq('id', motorId)
      .maybeSingle();
    if (maquinaAtualError) return dbError(maquinaAtualError, 'leitura_horimetro_snapshot');
    if (!maquinaAtual) continue; // motor não cadastrado: ignora

    const horasAtuais = Number(maquinaAtual.horas_acumuladas ?? 0);
    const ajusteAtual = Number(maquinaAtual.ajuste_id ?? 0);
    const primeiraVez = !maquinaAtual.horimetro_placa_em;
    const ajusteNovo = Number.isFinite(ajusteRecebido) && ajusteRecebido > ajusteAtual;

    let motivo = '';
    if (primeiraVez) motivo = 'assumido_pela_placa';
    else if (ajusteNovo) motivo = 'ajuste_no_painel';
    else if (horasRecebidas >= horasAtuais) motivo = 'contagem';
    else {
      recusados.push({ motor_id: motorId, recebido: horasRecebidas, atual: horasAtuais, motivo: 'menor_sem_ajuste' });
      console.warn(`horímetro menor sem ajuste recusado: ${motorId} ${horasRecebidas} < ${horasAtuais}`);
      continue;
    }

    const update: Record<string, unknown> = {
      horas_acumuladas: horasRecebidas,
      horimetro_placa_em: agora,
    };
    if (ajusteNovo) update.ajuste_id = ajusteRecebido;
    if (motivo !== 'contagem') {
      console.log(`horímetro ${motorId}: ${horasAtuais} -> ${horasRecebidas} (${motivo}, ajuste_id ${ajusteRecebido})`);
    }

    const { error: snapshotError } = await supabase
      .from('maquinas')
      .update(update)
      .eq('id', motorId);
    if (snapshotError) return dbError(snapshotError, 'snapshot_horimetro');
    horimetrosConfirmados.push({ motor_id: motorId, horas_acumuladas: horasRecebidas, motivo });
    snapshotsAtualizados += 1;
  }

  return json({
    ok: true,
    tipo: 'heartbeat',
    placa_id: placaId.trim(),
    conferencia_estados: snapshotsAtualizados,
    horimetros: horimetrosConfirmados,
    recusados,
  });
}

async function firmwareEvent(body: Record<string, unknown>): Promise<Response> {
  const placaId = body.placa_id;
  const motorId = body.motor_id ?? body.motor;
  const estado = body.estado;

  if (typeof placaId !== 'string' || !placaId.trim()) {
    return json({ ok: false, error: 'placa_id_obrigatorio' }, 400);
  }
  if (typeof motorId !== 'string' || !motorId.trim()) {
    return json({ ok: false, error: 'motor_id_obrigatorio' }, 400);
  }
  if (estado !== 'ligado' && estado !== 'desligado') {
    return json({ ok: false, error: 'estado_invalido', message: 'Use ligado ou desligado.' }, 400);
  }

  let horaEvento: string;
  try {
    horaEvento = timestampOf(body.timestamp ?? body.timestamp_evento);
  } catch (error) {
    return json({ ok: false, error: 'timestamp_invalido', message: String(error) }, 400);
  }

  const placa = placaId.trim();
  const motor = motorId.trim();

  const placaOk = await placaCadastrada(placa);
  if (placaOk.erro) return placaOk.erro;
  if (!placaOk.ok) {
    console.warn('evento de placa não cadastrada:', placa);
    return json({ ok: false, error: 'placa_nao_cadastrada' }, 403);
  }

  const eventIdRaw = typeof body.id_evento === 'string' ? body.id_evento.trim() : '';
  const eventId = eventIdRaw || `${placa}|${motor}|${estado}|${horaEvento}`;

  // Reenvio do mesmo evento: responde sucesso sem criar outra linha.
  const { data: eventoExistente, error: eventoExistenteError } = await supabase
    .from('eventos')
    .select('id, id_evento, placa_id, motor_id, estado, timestamp')
    .eq('id_evento', eventId)
    .maybeSingle();
  if (eventoExistenteError) return dbError(eventoExistenteError, 'verificacao_duplicidade');
  if (eventoExistente) {
    return json({
      ok: true,
      duplicado: true,
      motivo: 'id_evento_ja_recebido',
      evento: eventoExistente,
    }, 200);
  }

  const { data: maquina, error: maquinaReadError } = await supabase
    .from('maquinas')
    .select('id, nome, horas_acumuladas, ultimo_estado, ultima_atualizacao, meta_horas_turno, horimetro_placa_em')
    .eq('id', motor)
    .maybeSingle();
  if (maquinaReadError) return dbError(maquinaReadError, 'leitura_maquina');
  if (!maquina) {
    console.warn('evento de motor não cadastrado:', motor);
    return json({ ok: false, error: 'motor_nao_cadastrado' }, 403);
  }

  const previousTimestamp = maquina?.ultima_atualizacao
    ? new Date(maquina.ultima_atualizacao).getTime()
    : NaN;
  const currentTimestamp = new Date(horaEvento).getTime();

  // v9: evento mais antigo que o último estado (veio atrasado, ex.: fila da placa depois de queda de
  // internet). Antes era descartado e se perdia. Agora entra no histórico, sem mexer no estado atual
  // nem no horímetro, e as paradas daquele período são refeitas.
  if (Number.isFinite(previousTimestamp) && currentTimestamp <= previousTimestamp) {
    const { data: atrasado, error: atrasadoError } = await supabase
      .from('eventos')
      .insert({ id_evento: eventId, placa_id: placa, motor_id: motor, estado, timestamp: horaEvento })
      .select('id, id_evento, placa_id, motor_id, estado, timestamp')
      .single();
    if (atrasadoError && atrasadoError.code !== '23505') return dbError(atrasadoError, 'evento_atrasado');
    const reprocesso = MONITORED_MOTORS.has(motor) ? await reprocessarDesde(currentTimestamp) : null;
    return json({
      ok: true,
      guardado: true,
      motivo: 'evento_atrasado_guardado_no_historico',
      evento: atrasado ?? null,
      reprocesso,
    }, 200);
  }

  // O mesmo estado já registado não é uma nova transição de motor.
  if (maquina?.ultimo_estado === estado) {
    return json({
      ok: true,
      ignorado: true,
      motivo: 'estado_igual_ao_atual',
      motor: motor,
      estado,
      timestamp: horaEvento,
    }, 200);
  }

  const { data: evento, error: eventoError } = await supabase
    .from('eventos')
    .insert({
      id_evento: eventId,
      placa_id: placa,
      motor_id: motor,
      estado,
      timestamp: horaEvento,
    })
    .select('id, id_evento, placa_id, motor_id, estado, timestamp')
    .single();

  if (eventoError) {
    if (eventoError.code === '23505') {
      const { data: eventoDuplicado } = await supabase
        .from('eventos')
        .select('id, id_evento, placa_id, motor_id, estado, timestamp')
        .eq('id_evento', eventId)
        .maybeSingle();
      return json({
        ok: true,
        duplicado: true,
        motivo: 'id_evento_ja_recebido',
        evento: eventoDuplicado,
      }, 200);
    }
    return dbError(eventoError, 'evento_motor');
  }

  // Motor com horímetro gerido pela placa: as horas vêm do heartbeat, não do par de eventos.
  const geridoPelaPlaca = Boolean(maquina?.horimetro_placa_em);
  const wasRunning = maquina?.ultimo_estado === 'ligado';
  const isStopping = wasRunning && estado === 'desligado' && !geridoPelaPlaca;
  const elapsedHours = isStopping && Number.isFinite(previousTimestamp)
    ? Math.max(0, (currentTimestamp - previousTimestamp) / 3_600_000)
    : 0;

  const machineRow = {
    id: motor,
    nome: motor,
    ultimo_estado: estado,
    ultima_atualizacao: horaEvento,
    ...(isStopping ? { horas_acumuladas: Number(maquina?.horas_acumuladas ?? 0) + elapsedHours } : {}),
  };

  const { error: machineWriteError } = await supabase
    .from('maquinas')
    .upsert(machineRow, { onConflict: 'id' });

  if (machineWriteError) return dbError(machineWriteError, 'atualizacao_maquina');

  // v9: evento chegando com mais de 5 min de atraso veio da fila da placa: refaz as paradas do período.
  const reprocesso = MONITORED_MOTORS.has(motor) && Date.now() - currentTimestamp > ATRASO_REPROCESSA_MS
    ? await reprocessarDesde(currentTimestamp)
    : null;

  return json({
    ok: true,
    duplicado: false,
    evento,
    maquina: machineRow,
    horas_acrescentadas: elapsedHours,
    ...(reprocesso ? { reprocesso } : {}),
  }, 201);
}

type LogicalStopClaim = {
  criado: boolean;
  evento: Record<string, unknown>;
};

async function claimLogicalStop(row: Record<string, unknown>): Promise<LogicalStopClaim> {
  const motor = typeof row.motor === 'string' ? row.motor : '';
  const inicio = typeof row.inicio_parada === 'string' ? row.inicio_parada : '';
  const id = typeof row.id === 'string' && row.id
    ? row.id
    : `evt-${motor}-${new Date(inicio).getTime()}`;

  const { data, error } = await supabase.rpc('claim_logical_stop', {
    p_id: id,
    p_motor: motor,
    p_estagio: typeof row.estagio === 'string' ? row.estagio : null,
    p_inicio_parada: inicio,
    p_fim_parada: row.fim_parada ?? null,
    p_status: typeof row.status === 'string' ? row.status : 'pendente',
    p_tipo: typeof row.tipo === 'string' ? row.tipo : 'nao_programada',
    p_categoria: null,
    p_justificativa_texto: null,
    p_justificado_por: null,
    p_justificado_em: null,
    p_duracao_minutos: null,
  });

  if (error) throw error;
  const claim = data as { criado?: boolean; evento?: Record<string, unknown> } | null;
  if (!claim?.evento) throw new Error('A função de idempotência não devolveu a parada canônica.');
  return { criado: claim.criado === true, evento: claim.evento };
}

type Window = { dia: string; turno: number; startMs: number; endMs: number; turnoStartMs: number; turnoEndMs: number };

// Janelas produtivas (turnos menos pausas) vindas do banco: tabela turnos_config + pausas_config.
async function productiveWindows(fromMs: number, toMs: number): Promise<Window[]> {
  const { data, error } = await supabase.rpc('janelas_produtivas', {
    p_desde: new Date(fromMs).toISOString(),
    p_ate: new Date(toMs).toISOString(),
  });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, string | number>>).map((w) => ({
    dia: String(w.dia),
    turno: Number(w.turno),
    startMs: new Date(String(w.inicio)).getTime(),
    endMs: new Date(String(w.fim)).getTime(),
    turnoStartMs: new Date(String(w.turno_inicio)).getTime(),
    turnoEndMs: new Date(String(w.turno_fim)).getTime(),
  }));
}

function windowContaining(windows: Window[], ms: number): Window | null {
  return windows.find((w) => ms >= w.startMs && ms < w.endMs) ?? null;
}

type Reading = { tipo: 'ligou' | 'desligou'; timestamp: string };

// Último estado conhecido do motor, em qualquer horário (ESP32 + app).
async function latestReading(motor: string): Promise<Reading | null> {
  const [eventResult, readingResult] = await Promise.all([
    supabase.from('eventos').select('estado, timestamp').eq('motor_id', motor)
      .order('timestamp', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('leituras').select('tipo, timestamp').eq('motor', motor)
      .order('timestamp', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (eventResult.error) throw eventResult.error;
  if (readingResult.error) throw readingResult.error;
  const options: Reading[] = [];
  if (eventResult.data && (eventResult.data.estado === 'ligado' || eventResult.data.estado === 'desligado')) {
    options.push({ tipo: eventResult.data.estado === 'ligado' ? 'ligou' : 'desligou', timestamp: eventResult.data.timestamp });
  }
  if (readingResult.data && (readingResult.data.tipo === 'ligou' || readingResult.data.tipo === 'desligou')) {
    options.push({ tipo: readingResult.data.tipo, timestamp: readingResult.data.timestamp });
  }
  options.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return options[0] ?? null;
}

// Primeiro religamento do motor depois de um instante.
async function firstStartAfter(motor: string, afterIso: string): Promise<string | null> {
  const [eventResult, readingResult] = await Promise.all([
    supabase.from('eventos').select('timestamp').eq('motor_id', motor).eq('estado', 'ligado')
      .gt('timestamp', afterIso).order('timestamp', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('leituras').select('timestamp').eq('motor', motor).eq('tipo', 'ligou')
      .gt('timestamp', afterIso).order('timestamp', { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (eventResult.error) throw eventResult.error;
  if (readingResult.error) throw readingResult.error;
  const times = [eventResult.data?.timestamp, readingResult.data?.timestamp]
    .filter((value): value is string => typeof value === 'string')
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return times[0] ?? null;
}

async function scanStopsInBackground(): Promise<Response> {
  const now = new Date();
  const nowMs = now.getTime();
  const motors = Array.from(MONITORED_MOTORS);
  const created: string[] = [];
  const closed: string[] = [];

  // 1) Fechamento: roda sempre, inclusive fora do turno, para nenhuma parada
  //    ficar aberta para sempre. Fecha no primeiro religamento ou, se o turno
  //    acabar antes, no fim do turno em que a parada começou.
  const { data: openStops, error: openError } = await supabase
    .from('eventos_parada')
    .select('*')
    .in('motor', motors)
    .is('fim_parada', null)
    .order('inicio_parada', { ascending: true });
  if (openError) return dbError(openError, 'scan_paradas_abertas');

  const oldestOpenMs = Math.min(nowMs, ...(openStops ?? []).map((s) => new Date(s.inicio_parada).getTime()).filter(Number.isFinite));
  let windows: Window[];
  try {
    windows = await productiveWindows(oldestOpenMs - 86_400_000, nowMs + 86_400_000);
  } catch (error) {
    return dbError({ message: String(error) }, 'scan_janelas');
  }
  const current = windowContaining(windows, nowMs);

  const stillOpen = new Set<string>();
  for (const stop of openStops ?? []) {
    const startMs = new Date(stop.inicio_parada).getTime();
    if (!Number.isFinite(startMs)) continue;

    let restartIso: string | null;
    try {
      restartIso = await firstStartAfter(stop.motor, new Date(startMs).toISOString());
    } catch (error) {
      return dbError({ message: String(error) }, 'scan_religamento');
    }
    const restartMs = restartIso ? new Date(restartIso).getTime() : NaN;
    // Limite da parada: fim da janela produtiva onde ela começou (pausa ou fim do turno).
    const stopWindow = windowContaining(windows, startMs);
    const shiftEndMs = stopWindow ? stopWindow.endMs : startMs;

    let endMs: number | null = null;
    let reason = '';
    if (Number.isFinite(restartMs) && restartMs <= shiftEndMs) {
      endMs = restartMs;
      reason = 'religou';
    } else if (nowMs >= shiftEndMs) {
      endMs = shiftEndMs;
      reason = 'fim_da_janela';
    }

    if (endMs === null) {
      stillOpen.add(stop.motor);
      continue;
    }

    const { error } = await supabase
      .from('eventos_parada')
      .update({
        fim_parada: new Date(endMs).toISOString(),
        status: stop.status === 'justificado' ? 'justificado' : 'aguardando_justificativa',
        duracao_minutos: Math.max(0, Math.round((endMs - startMs) / 60_000)),
      })
      .eq('id', stop.id)
      .is('fim_parada', null);
    if (error) return dbError(error, 'scan_fechamento_parada');
    closed.push(`${stop.motor}:${stop.id}:${reason}`);
  }

  if (!current) {
    return json({ ok: true, scanned: false, reason: 'fora_do_turno_ou_pausa', closed });
  }

  // 2) Abertura: só dentro do turno, a partir do último estado conhecido.
  for (const motor of motors) {
    if (stillOpen.has(motor)) continue;

    let latest: Reading | null;
    try {
      latest = await latestReading(motor);
    } catch (error) {
      return dbError({ message: String(error) }, 'scan_ultima_leitura');
    }

    let candidateStart: string | null = null;
    if (!latest) {
      // Política B: motor sem nenhum sinal registrado, parada desde o início da janela.
      candidateStart = new Date(current.startMs).toISOString();
    } else if (latest.tipo === 'desligou') {
      const latestMs = new Date(latest.timestamp).getTime();
      const thresholdMs = (STOP_THRESHOLDS_MINUTES[motor] ?? 5) * 60_000;
      const startMs = Math.max(latestMs, current.startMs);
      if (Number.isFinite(startMs) && nowMs - startMs >= thresholdMs) {
        candidateStart = new Date(startMs).toISOString();
      }
    }

    if (!candidateStart) continue;

    const candidateId = `evt-${motor}-${new Date(candidateStart).getTime()}`;
    const event = {
      id: candidateId,
      motor,
      estagio: motor === 'AV10' ? 'primario' : 'secundario',
      inicio_parada: candidateStart,
      fim_parada: null,
      status: 'pendente',
      tipo: 'nao_programada',
    };

    let claim: LogicalStopClaim;
    try {
      claim = await claimLogicalStop(event);
    } catch (error) {
      return dbError({ message: String(error) }, 'scan_criacao_parada');
    }

    if (claim.criado) {
      created.push(`${motor}:${String(claim.evento.id ?? candidateId)}`);
    }
  }

  return json({
    ok: true,
    scanned: true,
    turno: current.turno,
    dia_producao: current.dia,
    janela_inicio: new Date(current.startMs).toISOString(),
    janela_fim: new Date(current.endMs).toISOString(),
    motors,
    created,
    closed,
  });
}

const ROTAS_DESATIVADAS = new Set(['/leituras', '/eventos', '/maquinas', '/placas', '/dispositivos', '/justificar']);

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  const path = pathOf(request);
  if (request.method === 'GET' && (path === '/' || path === '/health')) {
    return json({ ok: true, service: 'bright-api', version: 'v9-eventos-atrasados' });
  }
  if (request.method !== 'POST') {
    return ROTAS_DESATIVADAS.has(path)
      ? json({ ok: false, error: 'rota_desativada' }, 410)
      : json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  let body: Record<string, unknown> | null;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return json({ ok: false, error: 'invalid_json', message: String(error) }, 400);
  }
  if (!body) return json({ ok: false, error: 'empty_body' }, 400);

  // Heartbeat da placa é aceito em qualquer rota (como na versão anterior)
  if (body.tipo === 'heartbeat') return heartbeat(body);
  if (ROTAS_DESATIVADAS.has(path)) return json({ ok: false, error: 'rota_desativada' }, 410);
  if (path === '/scan') return scanStopsInBackground();
  if (path === '/' && tipoLeituraOf(body)) return firmwareEvent(body);

  return json({ ok: false, error: 'route_not_found' }, 404);
});
