import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// admin-usuarios: cadastro de usuário e troca de PIN feitos pelo supervisor no site.
// - Exige login (verify_jwt) e confere no banco que quem chama é supervisor ativo.
// - A chave de serviço fica só aqui no servidor; o site nunca a vê.
// - Login no padrão do app: <nome normalizado>@operador.paradas-britagem.app + PIN de 6 dígitos.

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DOMINIO_LOGIN = 'operador.paradas-britagem.app';
const PAPEIS = new Set(['operador', 'supervisor', 'manutencao']);
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
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

async function supervisorDaRequisicao(req: Request): Promise<{ id: string; nome: string } | Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return erro('sem_login', 401);
  const { data: u, error } = await admin.auth.getUser(token);
  if (error || !u?.user) return erro('sessao_invalida', 401);
  const { data: p, error: e2 } = await admin
    .from('usuarios_painel').select('nome, papel, ativo').eq('user_id', u.user.id).maybeSingle();
  if (e2) return erro('falha_banco', 500);
  if (!p || !p.ativo || p.papel !== 'supervisor') return erro('nao_autorizado', 403);
  return { id: u.user.id, nome: p.nome };
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
    .insert({ user_id: criado.user.id, nome, papel, area, ativo: true });
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
  return erro('acao_invalida', 400);
});
