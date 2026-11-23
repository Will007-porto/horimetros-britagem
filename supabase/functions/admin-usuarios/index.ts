import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// admin-usuarios: cadastro, troca de PIN e exclusão de usuário feitos pelo supervisor no site.
// - Exige login (verify_jwt) e confere no banco que quem chama é supervisor ativo.
// - A chave de serviço fica só aqui no servidor; o site nunca a vê.
// - Login no padrão do app: <nome normalizado>@operador.paradas-britagem.app + PIN de 6 dígitos.

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DOMINIO_LOGIN = 'operador.paradas-britagem.app';
// visualizador: só vê o site, nunca edita nem entra no app
const PAPEIS = new Set(['operador', 'supervisor', 'manutencao', 'visualizador']);
const AREAS = new Set(['PRIMARIO', 'SECUNDARIO', 'LOKOTRACK', 'AMBOS']);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });
const erro = (codigo: string, status: number) => json({ ok: false, error: codigo }, status);

// Mesma regra do app (src/config.ts → normalizarNomeLogin)
function normalizarNomeLogin(nome: string): string {
  return nome
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

// Chave pública do projeto (a mesma do site/app). Usada só para perguntar ao banco "quem sou eu"
// com o token de quem chamou: o banco confere a assinatura do token; token falso é recusado.
const PUBLISHABLE_KEY = 'sb_publishable_RS4gBYcvKEkBZKOXj-bHcQ_bo2aaQvY';

async function supervisorDaRequisicao(req: Request): Promise<{ id: string; nome: string } | Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || token.split('.').length !== 3) return erro('sem_login', 401);
  const comoUsuario = createClient(supabaseUrl, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: eu, error } = await comoUsuario.rpc('painel_eu');
  if (error || !eu?.uid) {
    if (error) console.warn('painel_eu:', error.message);
    return erro('sessao_invalida', 401);
  }
  if (!eu.autorizado || eu.papel !== 'supervisor') return erro('nao_autorizado', 403);
  return { id: eu.uid, nome: eu.nome };
}

async function criarUsuario(body: Record<string, unknown>, quem: { id: string; nome: string }): Promise<Response> {
  const nome = typeof body.nome === 'string' ? body.nome.trim().replace(/\s+/g, ' ') : '';
  const pin = typeof body.pin === 'string' ? body.pin : '';
  const papel = typeof body.papel === 'string' ? body.papel : '';
  const area = typeof body.area === 'string' ? body.area : '';
  if (nome.length < 2 || nome.length > 80) return erro('nome_invalido', 400);
  if (!/^\d{6}$/.test(pin)) return erro('pin_invalido', 400);
  if (!PAPEIS.has(papel)) return erro('papel_invalido', 400);
  if (!AREAS.has(area)) return erro('area_invalida', 400);
  if (papel === 'operador' && area === 'AMBOS') return erro('operador_uma_area', 400);

  const login = normalizarNomeLogin(nome);
  if (login.length < 2) return erro('nome_invalido', 400);
  const email = `${login}@${DOMINIO_LOGIN}`;

  const { data: criado, error } = await admin.auth.admin.createUser({
    email, password: pin, email_confirm: true, user_metadata: { nome, criado_por: quem.nome },
  });
  if (error || !criado?.user) {
    const msg = (error?.message ?? '').toLowerCase();
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) return erro('login_existe', 409);
    if (msg.includes('password')) return erro('pin_recusado', 400);
    console.error('createUser:', error);
    return erro('falha_criar', 500);
  }

  const { error: e2 } = await admin.from('usuarios_painel')
    .insert(papel === 'visualizador'
      ? { user_id: criado.user.id, nome, papel, area: 'AMBOS', ativo: true, acesso: 'site', editor: false }
      : { user_id: criado.user.id, nome, papel, area, ativo: true });
  if (e2) {
    console.error('usuarios_painel:', e2);
    await admin.auth.admin.deleteUser(criado.user.id); // desfaz para não deixar conta solta
    return erro('falha_cadastro', 500);
  }
  console.log(`usuario criado: ${login} (${papel}/${area}) por ${quem.nome}`);
  return json({ ok: true, user_id: criado.user.id, login, nome, papel, area }, 201);
}

async function trocarPin(body: Record<string, unknown>, quem: { id: string; nome: string }): Promise<Response> {
  const userId = typeof body.user_id === 'string' ? body.user_id : '';
  const pin = typeof body.pin === 'string' ? body.pin : '';
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return erro('usuario_invalido', 400);
  if (!/^\d{6}$/.test(pin)) return erro('pin_invalido', 400);

  const { data: alvo, error: e1 } = await admin.auth.admin.getUserById(userId);
  if (e1 || !alvo?.user) return erro('usuario_nao_encontrado', 404);
  if (!(alvo.user.email ?? '').endsWith(`@${DOMINIO_LOGIN}`)) return erro('usuario_fora_do_app', 400);

  const { error } = await admin.auth.admin.updateUserById(userId, { password: pin });
  if (error) {
    if ((error.message ?? '').toLowerCase().includes('password')) return erro('pin_recusado', 400);
    console.error('updateUserById:', error);
    return erro('falha_pin', 500);
  }
  console.log(`pin trocado: ${alvo.user.email} por ${quem.nome}`);
  return json({ ok: true });
}

// Apaga o login de vez. Paradas, justificativas e histórico NÃO são apagados (guardam o nome em texto).
async function apagarUsuario(body: Record<string, unknown>, quem: { id: string; nome: string }): Promise<Response> {
  const userId = typeof body.user_id === 'string' ? body.user_id : '';
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return erro('usuario_invalido', 400);
  if (userId === quem.id) return erro('nao_pode_apagar_a_si_mesmo', 400);

  const { data: alvo, error: e1 } = await admin.auth.admin.getUserById(userId);
  if (e1 || !alvo?.user) return erro('usuario_nao_encontrado', 404);
  const { data: perfil } = await admin.from('usuarios_painel').select('nome, papel, ativo').eq('user_id', userId).maybeSingle();
  if (!(alvo.user.email ?? '').endsWith(`@${DOMINIO_LOGIN}`) && !perfil) return erro('usuario_fora_do_app', 400);

  // Nunca deixar a planta sem supervisor ativo
  if (perfil?.papel === 'supervisor' && perfil.ativo) {
    const { count } = await admin.from('usuarios_painel')
      .select('user_id', { count: 'exact', head: true }).eq('papel', 'supervisor').eq('ativo', true);
    if ((count ?? 0) <= 1) return erro('ultimo_supervisor', 400);
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error('deleteUser:', error);
    return erro('falha_apagar', 500);
  }
  console.log(`usuario apagado: ${alvo.user.email} (${perfil?.nome ?? 'sem cadastro'}) por ${quem.nome}`);
  return json({ ok: true, nome: perfil?.nome ?? alvo.user.email });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return erro('method_not_allowed', 405);

  const quem = await supervisorDaRequisicao(req);
  if (quem instanceof Response) return quem;

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return erro('corpo_invalido', 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return erro('corpo_invalido', 400);
  }

  if (body.acao === 'criar') return criarUsuario(body, quem);
  if (body.acao === 'pin') return trocarPin(body, quem);
  if (body.acao === 'apagar') return apagarUsuario(body, quem);
  return erro('acao_invalida', 400);
});
