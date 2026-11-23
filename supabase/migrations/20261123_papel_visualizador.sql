-- Papel "visualizador": entra só no site, vê todas as áreas e não edita nada.
-- O banco força acesso='site', editor=false, area='AMBOS' e sem turno, e as funções de escrita recusam.

alter table public.usuarios_painel drop constraint usuarios_painel_papel_check;
alter table public.usuarios_painel add constraint usuarios_painel_papel_check
  check (papel = any (array['operador','supervisor','manutencao','visualizador']));

do $$
declare
  f text;
  troca record;
begin
  for troca in
    select * from (values
      ('public.app_supervisor_salvar(uuid,text,text,text,boolean,smallint,text,text,boolean,boolean)',
       $a$p_papel not in ('operador','supervisor','manutencao')$a$,
       $b$p_papel not in ('operador','supervisor','manutencao','visualizador')$b$),
      ('public.app_supervisor_salvar(uuid,text,text,text,boolean,smallint,text,text,boolean,boolean)',
       $a$if p_papel = 'supervisor' then v_acesso := 'tudo'; v_editor := true; end if;$a$,
       $b$if p_papel = 'supervisor' then v_acesso := 'tudo'; v_editor := true; end if;
  -- visualizador: só o site, só leitura, todas as áreas
  if p_papel = 'visualizador' then v_acesso := 'site'; v_editor := false; v_turno := null; end if;$b$),
      ('public.app_supervisor_salvar(uuid,text,text,text,boolean,smallint,text,text,boolean,boolean)',
       $a$values (p_user_id, v_nome, p_papel, p_area,$a$,
       $b$values (p_user_id, v_nome, p_papel, case when p_papel = 'visualizador' then 'AMBOS' else p_area end,$b$),
      ('public.app_justificar(text,text,text,integer,text,text)',
       $a$if v_area is null then raise exception 'sem_area'; end if;$a$,
       $b$if v_area is null then raise exception 'sem_area'; end if;
  if v_papel = 'visualizador' then raise exception 'sem_permissao'; end if;$b$),
      ('public.app_fracionar_parada(text,timestamptz)',
       $a$if v_area is null then raise exception 'sem_area'; end if;$a$,
       $b$if v_area is null then raise exception 'sem_area'; end if;
  if v_papel = 'visualizador' then raise exception 'sem_permissao'; end if;$b$)
    ) t(fn, de, para)
  loop
    f := pg_get_functiondef(troca.fn::regprocedure);
    if position(troca.de in f) = 0 then raise exception 'trecho não encontrado em %: %', troca.fn, troca.de; end if;
    execute replace(f, troca.de, troca.para);
  end loop;
end $$;
