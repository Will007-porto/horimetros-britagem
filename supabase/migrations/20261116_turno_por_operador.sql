-- Turno fixo por operador (aplicada em 16/11/2026 como "turno_por_operador" + "justificar_trava_turno_operador")
-- Objetivo: um operador não justifica as paradas do turno do colega.
--   usuarios_painel.turno: 1 = 1º turno, 2 = 2º turno, nulo = livre (folguista, cobre os dois)
--   Supervisor e manutenção não são afetados.

alter table public.usuarios_painel add column if not exists turno smallint check (turno in (1, 2));

-- Turnos que o usuário pode justificar: só os do seu turno cadastrado
create or replace function public.app_turnos_do_usuario()
 returns table(dia date, turno smallint, turno_inicio timestamptz, turno_fim timestamptz)
 language sql stable security definer set search_path to 'public'
as $$
  select t.dia, t.turno, t.turno_inicio, t.turno_fim
    from app_turnos_abertos() t
    left join usuarios_painel u on u.user_id = auth.uid() and u.ativo
   where (u.turno is null or u.papel <> 'operador' or t.turno = u.turno)
     and (now() < t.turno_fim
          or exists (select 1 from presenca_turno p
                      where p.user_id = auth.uid() and p.turno_inicio = t.turno_inicio));
$$;

-- app_eu, painel_eu e app_supervisor_usuarios passaram a devolver o campo "turno".

-- app_supervisor_salvar ganhou p_turno smallint default null:
--   nulo = mantém o turno atual (o app antigo não manda o campo), 0 = livre, 1 ou 2.
-- A versão de 5 argumentos foi removida para não haver ambiguidade.

-- app_justificar: quando a parada é de um turno aberto, mas do outro turno, o erro é
--   'parada_de_outro_turno' (antes caía no genérico 'fora_do_turno').
--   if v_papel <> 'supervisor' and not exists (... app_turnos_do_usuario() ...) then
--     if v_turno is not null and v_papel = 'operador' and exists (
--          select 1 from app_turnos_abertos() t
--           where t.turno <> v_turno and v_par.inicio_parada >= t.turno_inicio and v_par.inicio_parada < t.turno_fim) then
--       raise exception 'parada_de_outro_turno';
--     end if;
--     raise exception 'fora_do_turno';
--   end if;
