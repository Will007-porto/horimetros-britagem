import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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

function timestampOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return new Date().toISOString();

  const raw = value.trim();
  const possuiFuso = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  const normalizado = possuiFuso ? raw : `${raw}${BRAZIL_TIME_ZONE_OFFSET}`;
  const date = new Date(normalizado);

  if (Number.isNaN(date.getTime())) throw new Error('timestamp inválido');
  return date.toISOString();
}

function motorOf(body: Record<string, unknown>): string | null {
  const value = body.motor ?? body.motor_id;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

function brazilLocalParts(date: Date): { dateKey: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRAZIL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

type ServerShift = {
  dateKey: string;
  shiftId: 'primeiro' | 'segundo';
  label: string;
  startIso: string;
  endIso: string;
  startMs: number;
  endMs: number;
};

function addBrazilDateDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function isBrazilWeekday(dateKey: string): boolean {
  const [year, month, day] = dateKey.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

function makeServerShift(dateKey: string, shiftId: 'primeiro' | 'segundo'): ServerShift {
  const isFirst = shiftId === 'primeiro';
  const endDateKey = isFirst ? dateKey : addBrazilDateDays(dateKey, 1);
  const start = new Date(`${dateKey}T${isFirst ? '07:30:00' : '19:30:00'}-03:00`);
  const end = new Date(`${endDateKey}T${isFirst ? '18:00:00' : '05:00:00'}-03:00`);
  return {
    dateKey,
    shiftId,
    label: isFirst ? 'Turno 1' : 'Turno 2',
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

const MONITORED_MOTORS = new Set(['AV10', 'CV07']);
const STOP_THRESHOLDS_MINUTES: Record<string, number> = { AV10: 5, CV07: 3 };
const BRAZIL_TIME_ZONE = 'America/Sao_Paulo';
const fcmAccessTokenCache: { token: string; expiresAt: number } = {
  token: '',
  expiresAt: 0,
};

type FirebaseServiceAccount = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function utf8Base64Url(value: string): string {
  return base64Url(new TextEncoder().encode(value));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function firebaseServiceAccount(): FirebaseServiceAccount | null {
  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    ?? Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')
    ?? '';
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as FirebaseServiceAccount;
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch (error) {
    console.error('FIREBASE_SERVICE_ACCOUNT inválido:', error);
    return null;
  }
}

async function getFcmAccessToken(account: FirebaseServiceAccount): Promise<string> {
  const now = Date.now();
  if (fcmAccessTokenCache.token && fcmAccessTokenCache.expiresAt > now + 60_000) {
    return fcmAccessTokenCache.token;
  }

  const header = utf8Base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = utf8Base64Url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 3600,
  }));
  const unsignedToken = `${header}.${claim}`;
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(account.private_key!),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsignedToken),
  );
  const assertion = `${unsignedToken}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`OAuth2 FCM rejeitou a conta: HTTP ${response.status} ${responseText}`);
  const tokenResponse = JSON.parse(responseText) as { access_token?: string; expires_in?: number };
  if (!tokenResponse.access_token) throw new Error('OAuth2 FCM não devolveu access_token.');
  fcmAccessTokenCache.token = tokenResponse.access_token;
  fcmAccessTokenCache.expiresAt = now + (Number(tokenResponse.expires_in ?? 3600) * 1000);
  return fcmAccessTokenCache.token;
}

async function sendFcmMessage(token: string, event: Record<string, unknown>): Promise<{ ok: boolean; detail: string }> {
  const account = firebaseServiceAccount();
  if (!account) return { ok: false, detail: 'FIREBASE_SERVICE_ACCOUNT não configurado.' };
  const projectId = Deno.env.get('FIREBASE_PROJECT_ID') || account.project_id;
  if (!projectId) return { ok: false, detail: 'FIREBASE_PROJECT_ID ausente na conta de serviço.' };

  const motor = typeof event.motor === 'string' ? event.motor : 'equipamento';
  const label = motor === 'AV10' ? 'Primário' : motor === 'CV07' ? 'Secundário' : motor;
  const accessToken = await getFcmAccessToken(account);
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: {
          title: `⚠️ ${label} parado`,
          body: 'Nova parada aguardando justificação.',
        },
        data: {
          evento_id: String(event.id ?? ''),
          motor,
          status: String(event.status ?? 'pendente'),
        },
        android: {
          priority: 'HIGH',
          notification: {
            channel_id: 'paradas-alertas',
            icon: 'ic_stat_britagem',
            color: '#F97316',
            tag: String(event.id ?? motor),
          },
        },
      },
    }),
  });
  const responseText = await response.text();
  if (!response.ok) return { ok: false, detail: `FCM HTTP ${response.status}: ${responseText}` };
  return { ok: true, detail: responseText || 'enviado' };
}

async function notifyNewStop(event: Record<string, unknown>): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const motor = typeof event.motor === 'string' ? event.motor : '';
  if (!MONITORED_MOTORS.has(motor)) return { sent: 0, skipped: 0, errors: [] };
  if (!firebaseServiceAccount()) {
    return { sent: 0, skipped: 0, errors: ['FIREBASE_SERVICE_ACCOUNT não configurado no Supabase.'] };
  }

  const { data: devices, error: devicesError } = await supabase
    .from('dispositivos')
    .select('token_fcm')
    .eq('ativo', true)
    .eq('app_id', 'com.britagem.irati');
  if (devicesError) {
    console.error('consulta_dispositivos:', devicesError);
    return { sent: 0, skipped: 0, errors: [devicesError.message ?? 'falha ao consultar dispositivos'] };
  }

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const device of devices ?? []) {
    const token = typeof device.token_fcm === 'string' ? device.token_fcm.trim() : '';
    if (!token) continue;

    const { data: claim, error: claimError } = await supabase
      .from('notificacoes_push')
      .upsert({ evento_id: String(event.id), token_fcm: token, status: 'processando' }, {
        onConflict: 'evento_id,token_fcm',
        ignoreDuplicates: true,
      })
      .select('id')
      .maybeSingle();
    if (claimError) {
      errors.push(claimError.message ?? 'falha ao reservar notificação');
      continue;
    }
    if (!claim) {
      skipped += 1;
      continue;
    }

    try {
      const result = await sendFcmMessage(token, event);
      if (result.ok) {
        sent += 1;
        await supabase.from('notificacoes_push').update({
          status: 'enviado',
          enviado_em: new Date().toISOString(),
          resposta: result.detail.slice(0, 2000),
        }).eq('id', claim.id);
      } else {
        errors.push(result.detail);
        await supabase.from('notificacoes_push').update({
          status: 'erro',
          resposta: result.detail.slice(0, 2000),
        }).eq('id', claim.id);
      }
    } catch (error) {
      const detail = String(error);
      errors.push(detail);
      await supabase.from('notificacoes_push').update({
        status: 'erro',
        resposta: detail.slice(0, 2000),
      }).eq('id', claim.id);
    }
  }
  return { sent, skipped, errors };
}

async function saveDevice(body: Record<string, unknown>): Promise<Response> {
  const token = typeof body.token_fcm === 'string' ? body.token_fcm.trim() : '';
  const operator = typeof body.operador_nome === 'string' ? body.operador_nome.trim() : '';
  if (!token || !operator) {
    return json({ ok: false, error: 'payload_invalido', message: 'Informe token_fcm e operador_nome.' }, 400);
  }
  const row = {
    token_fcm: token,
    operador_nome: operator,
    plataforma: body.plataforma === 'android' ? 'android' : 'android',
    app_id: typeof body.app_id === 'string' && body.app_id ? body.app_id : 'com.britagem.irati',
    ativo: body.ativo !== false,
    ultimo_registro: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('dispositivos')
    .upsert(row, { onConflict: 'token_fcm' })
    .select('id, token_fcm, operador_nome, plataforma, app_id, ativo, ultimo_registro')
    .single();
  if (error) return dbError(error, 'registro_dispositivo');
  return json({ ok: true, dispositivo: data }, 201);
}

async function heartbeat(body: Record<string, unknown>): Promise<Response> {
  const placaId = body.placa_id;
  if (typeof placaId !== 'string' || !placaId.trim()) {
    return json({ ok: false, error: 'placa_id_obrigatorio' }, 400);
  }

  const { error } = await supabase.from('placas').upsert({
    id: placaId.trim(),
    ultima_atualizacao: new Date().toISOString(),
  }, { onConflict: 'id' });

  if (error) return dbError(error, 'heartbeat');

  const estados = Array.isArray(body.estados) ? body.estados : [];
  let snapshotsAtualizados = 0;
  const horimetrosConfirmados: Array<{ motor_id: string; horas_acumuladas: number }> = [];
  const agora = new Date().toISOString();

  for (const item of estados) {
    if (!item || typeof item !== 'object') continue;
    const snapshot = item as Record<string, unknown>;
    const motorId = typeof snapshot.motor_id === 'string' ? snapshot.motor_id.trim() : '';
    const estado = snapshot.estado;
    const horasRecebidas = Number(snapshot.horas_acumuladas);
    if (!motorId || (estado !== 'ligado' && estado !== 'desligado')) continue;

    const { data: maquinaAtual, error: maquinaAtualError } = await supabase
      .from('maquinas')
      .select('horas_acumuladas')
      .eq('id', motorId)
      .maybeSingle();
    if (maquinaAtualError) return dbError(maquinaAtualError, 'leitura_horimetro_snapshot');

    const horasAtuais = Number(maquinaAtual?.horas_acumuladas ?? 0);
    const horasSeguras = Number.isFinite(horasRecebidas)
      ? Math.max(horasAtuais, horasRecebidas)
      : horasAtuais;

    const { error: snapshotError } = await supabase
      .from('maquinas')
      .update({
        ultimo_estado: estado,
        ultima_atualizacao: agora,
        horas_acumuladas: horasSeguras,
      })
      .eq('id', motorId);
    if (snapshotError) return dbError(snapshotError, 'snapshot_estado');
    horimetrosConfirmados.push({ motor_id: motorId, horas_acumuladas: horasSeguras });
    snapshotsAtualizados += 1;
  }

  return json({
    ok: true,
    tipo: 'heartbeat',
    placa_id: placaId.trim(),
    conferencia_estados: snapshotsAtualizados,
    horimetros: horimetrosConfirmados,
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
    horaEvento = timestampOf(body.timestamp);
  } catch (error) {
    return json({ ok: false, error: 'timestamp_invalido', message: String(error) }, 400);
  }

  const placa = placaId.trim();
  const motor = motorId.trim();
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
    .select('id, nome, horas_acumuladas, ultimo_estado, ultima_atualizacao, meta_horas_turno')
    .eq('id', motor)
    .maybeSingle();
  if (maquinaReadError) return dbError(maquinaReadError, 'leitura_maquina');

  const previousTimestamp = maquina?.ultima_atualizacao
    ? new Date(maquina.ultima_atualizacao).getTime()
    : NaN;
  const currentTimestamp = new Date(horaEvento).getTime();

  // Eventos antigos reenviados depois de um estado mais novo não podem
  // voltar a alterar o estado nem acrescentar horas.
  if (Number.isFinite(previousTimestamp) && currentTimestamp <= previousTimestamp) {
    return json({
      ok: true,
      ignorado: true,
      motivo: 'evento_atrasado',
      motor: motor,
      estado,
      timestamp: horaEvento,
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

  const wasRunning = maquina?.ultimo_estado === 'ligado';
  const isStopping = wasRunning && estado === 'desligado';
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

  return json({
    ok: true,
    duplicado: false,
    evento,
    maquina: machineRow,
    horas_acrescentadas: elapsedHours,
  }, 201);
}

async function insertAppReading(body: Record<string, unknown>): Promise<Response> {
  const motor = motorOf(body);
  const tipo = tipoLeituraOf(body);
  if (!motor || !tipo) {
    return json({
      ok: false,
      error: 'payload_invalido',
      message: 'Informe motor/motor_id e tipo (ligou/desligou) ou estado (ligado/desligado).',
    }, 400);
  }

  let timestamp: string;
  try {
    timestamp = timestampOf(body.timestamp);
  } catch (error) {
    return json({ ok: false, error: 'timestamp_invalido', message: String(error) }, 400);
  }

  const { data, error } = await supabase
    .from('leituras')
    .insert({ motor, tipo, timestamp })
    .select('id, motor, tipo, timestamp, created_at')
    .single();

  if (error) return dbError(error, 'leitura_app');
  return json({ ok: true, leitura: data }, 201);
}

function eventRow(body: Record<string, unknown>): Record<string, unknown> {
  const motor = motorOf(body);
  const fallbackStage = motor?.startsWith('AV') || motor?.startsWith('BM') ? 'primario' : 'secundario';
  const row: Record<string, unknown> = {
    motor,
    estagio: body.estagio ?? fallbackStage,
    inicio_parada: body.inicio_parada,
    fim_parada: body.fim_parada ?? null,
    status: body.status ?? (body.fim_parada ? 'aguardando_justificativa' : 'pendente'),
    tipo: body.tipo ?? 'nao_programada',
  };

  for (const key of ['id', 'categoria', 'justificativa_texto', 'justificado_por', 'justificado_em', 'duracao_minutos']) {
    if (body[key] !== undefined) row[key] = body[key];
  }
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== null || value === null));
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
    p_categoria: typeof row.categoria === 'string' ? row.categoria : null,
    p_justificativa_texto: typeof row.justificativa_texto === 'string' ? row.justificativa_texto : null,
    p_justificado_por: typeof row.justificado_por === 'string' ? row.justificado_por : null,
    p_justificado_em: row.justificado_em ?? null,
    p_duracao_minutos: typeof row.duracao_minutos === 'number' ? row.duracao_minutos : null,
  });

  if (error) throw error;
  const claim = data as { criado?: boolean; evento?: Record<string, unknown> } | null;
  if (!claim?.evento) throw new Error('A função de idempotência não devolveu a parada canônica.');
  return { criado: claim.criado === true, evento: claim.evento };
}

function shiftContaining(ms: number): ServerShift | null {
  const local = brazilLocalParts(new Date(ms));
  const candidates: ServerShift[] = [];
  if (isBrazilWeekday(local.dateKey)) {
    candidates.push(makeServerShift(local.dateKey, 'primeiro'));
    candidates.push(makeServerShift(local.dateKey, 'segundo'));
  }

  // Entre 00:00 e 05:00, o turno pertence ao dia útil anterior.
  const previousDateKey = addBrazilDateDays(local.dateKey, -1);
  if (isBrazilWeekday(previousDateKey)) {
    candidates.push(makeServerShift(previousDateKey, 'segundo'));
  }

  return candidates.find((shift) => ms >= shift.startMs && ms < shift.endMs) ?? null;
}

function shiftForBrazilNow(now: Date): ServerShift | null {
  return shiftContaining(now.getTime());
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
  const notifications: Array<{ motor: string; sent: number; skipped: number; errors: string[] }> = [];

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
      notifications.push({ motor, ...(await notifyNewStop(claim.evento)) });
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
    notifications,
  });
}

async function saveStopEvent(body: Record<string, unknown>): Promise<Response> {
  const row = eventRow(body);
  if (typeof row.motor !== 'string' || typeof row.inicio_parada !== 'string') {
    return json({ ok: false, error: 'payload_invalido', message: 'Informe motor e inicio_parada.' }, 400);
  }

  let claim: LogicalStopClaim;
  try {
    claim = await claimLogicalStop(row);
  } catch (error) {
    return dbError({ message: String(error) }, 'evento_parada');
  }

  let notificacao: { sent: number; skipped: number; errors: string[] } | undefined;
  const isPendingStop = row.status === 'pendente' || row.status === 'aguardando_justificativa';
  if (claim.criado && isPendingStop) {
    notificacao = await notifyNewStop(claim.evento);
  }

  return json({ ok: true, evento: claim.evento, ...(notificacao ? { notificacao } : {}) }, 201);
}

async function saveJustification(body: Record<string, unknown>): Promise<Response> {
  const eventId = typeof body.id === 'string' ? body.id.trim() : '';
  if (!eventId) {
    return json({ ok: false, error: 'id_evento_obrigatorio' }, 400);
  }

  const motor = motorOf(body);
  const categoria = typeof body.categoria === 'string' ? body.categoria.trim() : '';
  const justificativaTexto = typeof body.justificativa_texto === 'string'
    ? body.justificativa_texto.trim()
    : '';
  const justificadoPor = typeof body.justificado_por === 'string'
    ? body.justificado_por.trim()
    : '';

  if (!categoria || !justificativaTexto || !justificadoPor) {
    return json({
      ok: false,
      error: 'payload_invalido',
      message: 'Informe categoria, justificativa_texto e justificado_por.',
    }, 400);
  }

  // A aplicação pode criar a parada localmente antes de a sincronização
  // alcançar o banco. Por isso esta rota precisa ser um upsert, não um
  // UPDATE seguido de .single(): se o ID ainda não existir, a parada é
  // criada já com a justificativa.
  const row: Record<string, unknown> = {
    id: eventId,
    status: 'justificado',
    categoria,
    tipo: body.tipo === 'programada' ? 'programada' : 'nao_programada',
    justificativa_texto: justificativaTexto,
    justificado_por: justificadoPor,
    justificado_em: body.justificado_em ?? new Date().toISOString(),
  };

  const optionalFields = [
    'motor',
    'estagio',
    'inicio_parada',
    'fim_parada',
    'duracao_minutos',
  ];
  for (const key of optionalFields) {
    if (body[key] !== undefined) row[key] = body[key];
  }

  // Um ID novo necessita do contexto mínimo da parada para não criar uma
  // linha incompleta. Para um ID já existente, esses campos podem ser
  // omitidos por versões antigas do aplicativo.
  if (motor !== null) row.motor = motor;
  if (!row.motor || typeof row.inicio_parada !== 'string' || !row.inicio_parada) {
    const { data: existing, error: existingError } = await supabase
      .from('eventos_parada')
      .select('id, motor, estagio, inicio_parada, fim_parada, duracao_minutos')
      .eq('id', eventId)
      .maybeSingle();

    if (existingError) return dbError(existingError, 'leitura_justificacao');
    if (!existing) {
      return json({
        ok: false,
        error: 'contexto_parada_obrigatorio',
        message: 'Para criar uma parada nova, envie motor e inicio_parada.',
      }, 400);
    }

    for (const key of ['motor', 'estagio', 'inicio_parada', 'fim_parada', 'duracao_minutos']) {
      if (row[key] === undefined && existing[key] !== undefined) row[key] = existing[key];
    }
  }

  const { data, error } = await supabase
    .from('eventos_parada')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();

  if (error) return dbError(error, 'justificacao');
  return json({ ok: true, created_or_updated: true, evento: data });
}

async function listReadings(): Promise<Response> {
  const [newReadings, legacyEvents] = await Promise.all([
    supabase.from('leituras').select('id, motor, tipo, timestamp, created_at').order('timestamp', { ascending: false }),
    supabase.from('eventos').select('id, id_evento, placa_id, motor_id, estado, timestamp').order('timestamp', { ascending: false }),
  ]);
  if (newReadings.error) return dbError(newReadings.error, 'consulta_leituras');
  if (legacyEvents.error) return dbError(legacyEvents.error, 'consulta_eventos_legacy');

  const mappedLegacy = (legacyEvents.data ?? []).map((event) => ({
    id: event.id_evento || `legacy-${event.id}`,
    id_evento: event.id_evento,
    placa_id: event.placa_id,
    motor: event.motor_id,
    tipo: event.estado === 'ligado' ? 'ligou' : 'desligou',
    timestamp: event.timestamp,
  }));
  const result = [...(newReadings.data ?? []), ...mappedLegacy]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return json(result);
}

async function listStops(): Promise<Response> {
  const { data, error } = await supabase
    .from('eventos_parada')
    .select('*')
    .order('inicio_parada', { ascending: false });
  if (error) return dbError(error, 'consulta_eventos_parada');
  return json(data ?? []);
}

async function listMachines(): Promise<Response> {
  const { data, error } = await supabase
    .from('maquinas')
    .select('id, nome, ultimo_estado, ultima_atualizacao, horas_acumuladas, meta_horas_turno')
    .order('id', { ascending: true });
  if (error) return dbError(error, 'consulta_maquinas');
  return json(data ?? []);
}

async function listBoards(): Promise<Response> {
  const { data, error } = await supabase
    .from('placas')
    .select('id, ultima_atualizacao')
    .order('id', { ascending: true });
  if (error) return dbError(error, 'consulta_placas');
  return json(data ?? []);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  const path = pathOf(request);
  if (request.method === 'GET' && (path === '/' || path === '/health')) {
    return json({ ok: true, service: 'bright-api', version: 'bridge-v6-janelas-produtivas' });
  }
  if (request.method === 'GET' && path === '/leituras') return listReadings();
  if (request.method === 'GET' && path === '/eventos') return listStops();
  if (request.method === 'GET' && path === '/maquinas') return listMachines();
  if (request.method === 'GET' && path === '/placas') return listBoards();
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let body: Record<string, unknown> | null;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return json({ ok: false, error: 'invalid_json', message: String(error) }, 400);
  }
  if (!body) return json({ ok: false, error: 'empty_body' }, 400);

  if (body.tipo === 'heartbeat') return heartbeat(body);
  if (path === '/dispositivos') return saveDevice(body);
  if (path === '/scan') return scanStopsInBackground();
  if (path === '/leituras') return insertAppReading(body);
  if (path === '/eventos') return saveStopEvent(body);
  if (path === '/justificar') return saveJustification(body);
  if (path === '/' && tipoLeituraOf(body)) return firmwareEvent(body);

  return json({ ok: false, error: 'route_not_found' }, 404);
});
