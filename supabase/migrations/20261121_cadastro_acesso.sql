-- Cadastro da equipe: cargo, onde a pessoa entra (app / site / tudo), visualizador ou editor no site
-- e troca obrigatória do PIN no próximo acesso.
--   acesso   'app'  = só o aplicativo · 'site' = só o painel · 'tudo' = os dois
--   editor   no site: false = só vê; true = faz o que o papel permite (justificar, validar, dividir)
--            supervisor é sempre editor e sempre tem acesso a tudo
--   trocar_pin  no próximo login (app ou site) a pessoa escolhe um PIN novo antes de seguir
alter table public.usuarios_painel
  add column if not exists cargo text,
  add column if not exists acesso text not null default 'tudo',
  add column if not exists editor boolean not null default true,   -- quem já existe continua como estava
  add column if not exists trocar_pin boolean not null default false,
  add column if not exists pin_trocado_em timestamptz;
alter table public.usuarios_painel alter column editor set default false;  -- novos entram como visualizador
alter table public.usuarios_painel drop constraint if exists usuarios_painel_acesso_check;
alter table public.usuarios_painel add constraint usuarios_painel_acesso_check check (acesso in ('app','site','tudo'));
alter table public.usuarios_painel drop constraint if exists usuarios_painel_cargo_check;
alter table public.usuarios_painel add constraint usuarios_painel_cargo_check check (cargo is null or length(cargo) between 2 and 60);
update public.usuarios_painel set acesso = 'tudo', editor = true where papel = 'supervisor';

-- Quem sou eu no SITE: só autorizado se o acesso inclui o site
create or replace function public.painel_eu()
 returns json language sql stable security definer set search_path to 'public'
as $function$
  select json_build_object(
    'logado', auth.uid() is not null, 'uid', auth.uid(), 'nome', u.nome,
    'autorizado', u.user_id is not null and u.acesso in ('site','tudo'),
    'so_app', coalesce(u.acesso = 'app', false),
    'papel', u.papel, 'area', u.area, 'turno', u.turno, 'cargo', u.cargo, 'acesso', u.acesso,
    'editor', coalesce(u.papel = 'supervisor' or u.editor, false),
    'trocar_pin', coalesce(u.trocar_pin, false))
  from (select 1) x
  left join usuarios_painel u on u.user_id = auth.uid() and u.ativo;
$function$;

-- Quem sou eu no APP: só autorizado se o acesso inclui o app
create or replace function public.app_eu()
 returns json language sql stable security definer set search_path to 'public'
as $function$
  select json_build_object(
    'logado', auth.uid() is not null,
    'autorizado', u.user_id is not null and u.acesso in ('app','tudo'),
    'so_site', coalesce(u.acesso = 'site', false),
    'nome', u.nome, 'papel', u.papel, 'area', u.area, 'turno', u.turno, 'cargo', u.cargo,
    'trocar_pin', coalesce(u.trocar_pin, false))
  from (select 1) x
  left join usuarios_painel u on u.user_id = auth.uid() and u.ativo;
$function$;

-- Lista da Equipe (supervisor)
create or replace function public.app_supervisor_usuarios()
 returns json language plpgsql stable security definer set search_path to 'public', 'auth'
as $function$
begin
  if not app_eh_supervisor() then raise exception 'nao_autorizado'; end if;
  return (
    select coalesce(json_agg(r order by r.liberado, r.ativo desc, r.nome), '[]'::json) from (
      select u.id as user_id,
             split_part(u.email, '@', 1) as login,
             coalesce(p.nome, initcap(replace(split_part(u.email, '@', 1), '.', ' '))) as nome,
             p.papel, p.area, p.turno, p.cargo, coalesce(p.acesso, 'tudo') as acesso,
             coalesce(p.papel = 'supervisor' or p.editor, false) as editor,
             coalesce(p.trocar_pin, false) as trocar_pin, p.pin_trocado_em,
             coalesce(p.ativo, false) as ativo,
             (p.user_id is not null) as liberado,
             (u.id = auth.uid()) as eu,
             u.created_at as criado_em,
             u.last_sign_in_at as ultimo_acesso
        from auth.users u
        left join usuarios_painel p on p.user_id = u.id
       where p.user_id is not null or u.email like '%@operador.paradas-britagem.app'
    ) r);
end;
$function$;

-- Salvar cadastro (supervisor). Parâmetros novos em null = mantém o que já estava.
drop function if exists public.app_supervisor_salvar(uuid, text, text, text, boolean, smallint);
create or replace function public.app_supervisor_salvar(
  p_user_id uuid, p_nome text, p_papel text, p_area text, p_ativo boolean default true, p_turno smallint default null,
  p_cargo text default null, p_acesso text default null, p_editor boolean default null, p_trocar_pin boolean default null)
 returns json language plpgsql security definer set search_path to 'public', 'auth'
as $function$
declare v_nome text := btrim(coalesce(p_nome, '')); v_turno smallint; v_cargo text; v_acesso text; v_editor boolean; v_trocar boolean;
        v_old usuarios_painel%rowtype;
begin
  if not app_eh_supervisor() then raise exception 'nao_autorizado'; end if;
  if not exists (select 1 from auth.users where id = p_user_id) then raise exception 'usuario_nao_encontrado'; end if;
  if length(v_nome) < 2 or length(v_nome) > 80 then raise exception 'nome_invalido'; end if;
  if p_papel not in ('operador','supervisor','manutencao') then raise exception 'papel_invalido'; end if;
  if p_area is not null and p_area not in ('PRIMARIO','SECUNDARIO','LOKOTRACK','AMBOS') then raise exception 'area_invalida'; end if;
  if p_papel = 'operador' and p_area is null then raise exception 'area_obrigatoria'; end if;
  if p_papel = 'operador' and p_area = 'AMBOS' then raise exception 'operador_uma_area'; end if;
  if p_turno is not null and p_turno not in (0, 1, 2) then raise exception 'turno_invalido'; end if;
  if p_acesso is not null and p_acesso not in ('app','site','tudo') then raise exception 'acesso_invalido'; end if;
  if p_cargo is not null and length(btrim(p_cargo)) not between 0 and 60 then raise exception 'cargo_invalido'; end if;
  if p_user_id = auth.uid() and (p_papel <> 'supervisor' or not coalesce(p_ativo, true)) then
    raise exception 'nao_pode_rebaixar_a_si_mesmo';
  end if;

  select * into v_old from usuarios_painel where user_id = p_user_id;
  v_turno  := case when p_turno is null then v_old.turno else nullif(p_turno, 0) end;
  v_cargo  := case when p_cargo is null then v_old.cargo else nullif(btrim(p_cargo), '') end;
  if v_cargo is not null and length(v_cargo) < 2 then raise exception 'cargo_invalido'; end if;
  v_acesso := coalesce(p_acesso, v_old.acesso, 'tudo');
  v_editor := coalesce(p_editor, v_old.editor, false);
  v_trocar := coalesce(p_trocar_pin, v_old.trocar_pin, false);
  if p_papel = 'supervisor' then v_acesso := 'tudo'; v_editor := true; end if;

  insert into usuarios_painel (user_id, nome, papel, area, ativo, turno, cargo, acesso, editor, trocar_pin)
  values (p_user_id, v_nome, p_papel, p_area, coalesce(p_ativo, true), v_turno, v_cargo, v_acesso, v_editor, v_trocar)
  on conflict (user_id) do update
    set nome = excluded.nome, papel = excluded.papel, area = excluded.area, ativo = excluded.ativo,
        turno = excluded.turno, cargo = excluded.cargo, acesso = excluded.acesso, editor = excluded.editor,
        trocar_pin = excluded.trocar_pin;

  return json_build_object('user_id', p_user_id, 'nome', v_nome, 'papel', p_papel, 'area', p_area,
                           'ativo', coalesce(p_ativo, true), 'turno', v_turno, 'cargo', v_cargo,
                           'acesso', v_acesso, 'editor', v_editor, 'trocar_pin', v_trocar);
end;
$function$;
revoke all on function public.app_supervisor_salvar(uuid, text, text, text, boolean, smallint, text, text, boolean, boolean) from public, anon;
grant execute on function public.app_supervisor_salvar(uuid, text, text, text, boolean, smallint, text, text, boolean, boolean) to authenticated;

-- A própria pessoa avisa que já trocou o PIN (o PIN em si é trocado pelo login dela, no Auth).
create or replace function public.app_pin_trocado()
 returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'sem_login'; end if;
  update usuarios_painel set trocar_pin = false, pin_trocado_em = now() where user_id = auth.uid();
  return json_build_object('ok', true);
end;
$function$;
revoke all on function public.app_pin_trocado() from public, anon;
grant execute on function public.app_pin_trocado() to authenticated;
