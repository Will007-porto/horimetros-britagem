-- Turnos e pausas da britagem como dados (não mais fixos no código).
-- Mudou horário? Edite estas tabelas: scanner e site passam a usar na hora.

create table if not exists public.turnos_config (
  id serial primary key,
  dia_semana smallint not null check (dia_semana between 1 and 7), -- 1=segunda ... 7=domingo (ISO)
  turno smallint not null check (turno in (1,2)),
  inicio time not null,
  fim time not null,            -- se fim <= inicio, termina no dia seguinte
  eventual boolean not null default false, -- só vale se algum motor ligar dentro do turno
  ativo boolean not null default true,
  unique (dia_semana, turno)
);

create table if not exists public.pausas_config (
  id serial primary key,
  dia_semana smallint not null check (dia_semana between 1 and 7),
  turno smallint not null check (turno in (1,2)),
  nome text not null,
  inicio time not null,
  fim time not null,
  ativo boolean not null default true
);

insert into public.turnos_config (dia_semana, turno, inicio, fim, eventual)
select d, 1, time '07:30', time '18:30', false from generate_series(1,5) d
union all select d, 2, time '18:30', time '04:00', false from generate_series(1,5) d
union all select 6, 1, time '07:30', time '16:00', false
union all select 6, 2, time '16:00', time '23:00', false
union all select 7, 1, time '07:30', time '16:00', true
on conflict (dia_semana, turno) do nothing;

insert into public.pausas_config (dia_semana, turno, nome, inicio, fim)
select d, 1, 'Almoço', time '12:30', time '13:30' from generate_series(1,7) d
union all select d, 2, 'Janta', time '21:00', time '22:00' from generate_series(1,5) d
union all select 6, 2, 'Janta', time '19:00', time '20:00';

alter table public.turnos_config enable row level security;
alter table public.pausas_config enable row level security;
create policy "leitura turnos" on public.turnos_config for select to anon, authenticated using (true);
create policy "leitura pausas" on public.pausas_config for select to anon, authenticated using (true);

-- Janelas produtivas = turnos menos pausas, em horário de Brasília.
create or replace function public.janelas_produtivas(p_desde timestamptz, p_ate timestamptz)
returns table (dia date, turno smallint, turno_inicio timestamptz, turno_fim timestamptz, inicio timestamptz, fim timestamptz)
language sql stable
set search_path = public
as $$
  with dias as (
    select d::date d
    from generate_series((p_desde at time zone 'America/Sao_Paulo')::date - 1,
                         (p_ate at time zone 'America/Sao_Paulo')::date, interval '1 day') d
  ),
  tur as (
    select dd.d dia, t.turno, t.dia_semana, t.inicio hi, t.eventual,
           (dd.d + t.inicio) at time zone 'America/Sao_Paulo' ti,
           (dd.d + t.fim + case when t.fim <= t.inicio then interval '1 day' else interval '0' end) at time zone 'America/Sao_Paulo' tf
    from dias dd
    join turnos_config t on t.ativo and t.dia_semana = extract(isodow from dd.d)
  ),
  tur_ok as (
    select * from tur
    where not eventual
       or exists (select 1 from eventos e where e.estado = 'ligado' and e."timestamp" >= tur.ti and e."timestamp" < tur.tf)
  ),
  pau as (
    select tu.dia, tu.turno,
           (tu.dia + p.inicio + case when p.inicio < tu.hi then interval '1 day' else interval '0' end) at time zone 'America/Sao_Paulo' pi,
           (tu.dia + p.fim + case when p.fim <= tu.hi then interval '1 day' else interval '0' end) at time zone 'America/Sao_Paulo' pf
    from tur_ok tu
    join pausas_config p on p.ativo and p.dia_semana = tu.dia_semana and p.turno = tu.turno
  ),
  cortes as (
    select tu.dia, tu.turno, tu.ti, tu.tf, tu.ti a from tur_ok tu
    union all
    select tu.dia, tu.turno, tu.ti, tu.tf, p.pf from tur_ok tu join pau p using (dia, turno) where p.pf > tu.ti and p.pf < tu.tf
  ),
  jan as (
    select c.dia, c.turno, c.ti, c.tf, c.a,
           least(c.tf, coalesce((select min(p.pi) from pau p where p.dia = c.dia and p.turno = c.turno and p.pi >= c.a), c.tf)) b
    from cortes c
  )
  select dia, turno, ti, tf, a, b
  from jan
  where b > a and a < p_ate and b > p_desde
  order by a;
$$;

grant execute on function public.janelas_produtivas(timestamptz, timestamptz) to anon, authenticated, service_role;
