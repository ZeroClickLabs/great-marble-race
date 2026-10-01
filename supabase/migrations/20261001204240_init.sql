-- Great Marble Race: games, players, betting markets and pari-mutuel settlement.
--
-- Clients only ever SELECT tables directly. Every write goes through an RPC:
-- thin `security invoker` wrappers in `public` call `security definer`
-- implementations in the unexposed `private` schema, which check that the caller
-- is a member (players) or the host (race control) of the game.

create schema if not exists private;

-- ---------------------------------------------------------------- tables

create table public.games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- lobby -> betting -> racing -> results -> (betting ...) -> finished
  status text not null default 'lobby' check (status in ('lobby', 'betting', 'racing', 'results', 'finished')),
  round int not null default 0,
  -- { "eliminations": [4,4,3,2,1,1], "startingBalance": 1000 }
  config jsonb not null,
  race_seed bigint,
  created_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 24),
  balance int not null check (balance >= 0),
  created_at timestamptz not null default now(),
  unique (game_id, user_id)
);
create index on public.players (game_id);

create table public.marbles (
  game_id uuid not null references public.games (id) on delete cascade,
  slot int not null check (slot between 0 and 15),
  eliminated_round int,
  primary key (game_id, slot)
);

-- Hidden per-marble "form" for the tournament. Only the host can read it.
create table public.game_secrets (
  game_id uuid primary key references public.games (id) on delete cascade,
  forms jsonb not null
);

create table public.markets (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  round int not null,
  kind text not null check (kind in ('outright', 'round_winner', 'round_elim', 'prop')),
  question text not null,
  -- [{ "key": "3", "label": "Bumblebee", "slot": 3 }, ...]
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2),
  -- Number of winning options expected (e.g. 4 marbles eliminated). Used for odds display.
  winners_expected int not null default 1,
  -- Virtual stake added to every option so early odds aren't infinite.
  seed_pool int not null default 50,
  status text not null default 'open' check (status in ('open', 'locked', 'settled', 'void')),
  closes_at timestamptz,
  result text[],
  created_at timestamptz not null default now()
);
create index on public.markets (game_id);

create table public.bets (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  option text not null,
  amount int not null check (amount > 0),
  payout int,
  created_at timestamptz not null default now()
);
create index on public.bets (game_id);
create index on public.bets (market_id);

-- ---------------------------------------------------------------- RLS

alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.marbles enable row level security;
alter table public.game_secrets enable row level security;
alter table public.markets enable row level security;
alter table public.bets enable row level security;

create function private.is_member(p_game uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.games g where g.id = p_game and g.host_id = (select auth.uid()))
      or exists (select 1 from public.players p where p.game_id = p_game and p.user_id = (select auth.uid()));
$$;

create policy "members read games" on public.games for select to authenticated using ((select private.is_member(id)));
create policy "members read players" on public.players for select to authenticated using ((select private.is_member(game_id)));
create policy "members read marbles" on public.marbles for select to authenticated using ((select private.is_member(game_id)));
create policy "members read markets" on public.markets for select to authenticated using ((select private.is_member(game_id)));
create policy "members read bets" on public.bets for select to authenticated using ((select private.is_member(game_id)));
create policy "host reads secrets" on public.game_secrets for select to authenticated
  using (exists (select 1 from public.games g where g.id = game_id and g.host_id = (select auth.uid())));

-- New tables are not exposed to the Data API automatically: grant reads explicitly.
grant usage on schema public to authenticated;
grant select on public.games, public.players, public.marbles, public.game_secrets, public.markets, public.bets to authenticated;
revoke all on public.games, public.players, public.marbles, public.game_secrets, public.markets, public.bets from anon;

-- ---------------------------------------------------------------- helpers

create function private.assert_host(p_game uuid) returns public.games
language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game;
  if g.id is null or g.host_id is distinct from (select auth.uid()) then
    raise exception 'only the host can do that' using errcode = '42501';
  end if;
  return g;
end $$;

-- ---------------------------------------------------------------- game setup

create function private.create_game(p_config jsonb) returns public.games
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code text;
  i int;
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(letters, 1 + floor(random() * length(letters))::int, 1);
    end loop;
    exit when not exists (select 1 from public.games where code = v_code);
  end loop;

  insert into public.games (code, config) values (v_code, p_config) returning * into g;
  insert into public.marbles (game_id, slot) select g.id, s from generate_series(0, 15) s;
  insert into public.game_secrets (game_id, forms)
    select g.id, jsonb_agg(round((random() * 2 - 1)::numeric, 2)) from generate_series(0, 15);
  return g;
end $$;

create function private.join_game(p_code text, p_nickname text) returns public.players
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  p public.players;
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  select * into g from public.games where code = upper(trim(p_code));
  if g.id is null then raise exception 'No game with code %', upper(trim(p_code)) using errcode = 'P0002'; end if;
  insert into public.players (game_id, nickname, balance)
    values (g.id, trim(p_nickname), coalesce((g.config ->> 'startingBalance')::int, 1000))
    on conflict (game_id, user_id) do update set nickname = excluded.nickname
    returning * into p;
  return p;
end $$;

-- ---------------------------------------------------------------- betting

create function private.place_bet(p_market uuid, p_option text, p_amount int) returns public.bets
language plpgsql security definer set search_path = '' as $$
declare
  m public.markets;
  p public.players;
  b public.bets;
begin
  select * into m from public.markets where id = p_market;
  if m.id is null then raise exception 'market not found'; end if;
  if m.status <> 'open' or (m.closes_at is not null and now() >= m.closes_at) then
    raise exception 'Betting is closed for this market' using errcode = 'P0001';
  end if;
  if not exists (select 1 from jsonb_array_elements(m.options) o where o ->> 'key' = p_option) then
    raise exception 'unknown option';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Bet must be positive'; end if;

  select * into p from public.players where game_id = m.game_id and user_id = (select auth.uid()) for update;
  if p.id is null then raise exception 'join the game first'; end if;
  if p.balance < p_amount then raise exception 'Not enough Marble Bucks' using errcode = 'P0001'; end if;

  update public.players set balance = balance - p_amount where id = p.id;
  insert into public.bets (market_id, game_id, player_id, option, amount)
    values (m.id, m.game_id, p.id, p_option, p_amount) returning * into b;
  return b;
end $$;

-- ---------------------------------------------------------------- race control (host only)

create function private.open_market(
  p_game uuid, p_round int, p_kind text, p_question text, p_options jsonb,
  p_winners_expected int, p_window_seconds int
) returns public.markets
language plpgsql security definer set search_path = '' as $$
declare m public.markets;
begin
  perform private.assert_host(p_game);
  insert into public.markets (game_id, round, kind, question, options, winners_expected, closes_at)
    values (p_game, p_round, p_kind, p_question, p_options, greatest(1, p_winners_expected),
            case when p_window_seconds is null then null else now() + make_interval(secs => p_window_seconds) end)
    returning * into m;
  return m;
end $$;

create function private.lock_markets(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_game uuid;
begin
  for v_game in select distinct game_id from public.markets where id = any (p_ids) loop
    perform private.assert_host(v_game);
  end loop;
  update public.markets set status = 'locked', closes_at = least(coalesce(closes_at, now()), now())
    where id = any (p_ids) and status = 'open';
end $$;

-- Pari-mutuel: every stake (plus the virtual seed on each option) goes in one pot;
-- winning stakes split it in proportion to their size.
create function private.settle_market(p_market uuid, p_winners text[]) returns public.markets
language plpgsql security definer set search_path = '' as $$
declare
  m public.markets;
  v_total numeric;
  v_win numeric;
begin
  select * into m from public.markets where id = p_market for update;
  if m.id is null then raise exception 'market not found'; end if;
  perform private.assert_host(m.game_id);
  if m.status in ('settled', 'void') then return m; end if;

  select coalesce(sum(amount), 0) + m.seed_pool * jsonb_array_length(m.options) into v_total
    from public.bets where market_id = m.id;
  select coalesce(sum(amount), 0) + m.seed_pool * cardinality(p_winners) into v_win
    from public.bets where market_id = m.id and option = any (p_winners);

  update public.bets
    set payout = case when option = any (p_winners) and v_win > 0 then floor(amount * v_total / v_win)::int else 0 end
    where market_id = m.id;

  update public.players p set balance = p.balance + w.total
    from (select player_id, sum(payout) as total from public.bets where market_id = m.id group by player_id) w
    where p.id = w.player_id and w.total > 0;

  update public.markets set status = 'settled', result = p_winners, closes_at = coalesce(closes_at, now())
    where id = m.id returning * into m;
  return m;
end $$;

create function private.void_market(p_market uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.markets;
begin
  select * into m from public.markets where id = p_market for update;
  perform private.assert_host(m.game_id);
  if m.status in ('settled', 'void') then return; end if;
  update public.bets set payout = amount where market_id = m.id;
  update public.players p set balance = p.balance + w.total
    from (select player_id, sum(amount) as total from public.bets where market_id = m.id group by player_id) w
    where p.id = w.player_id;
  update public.markets set status = 'void' where id = m.id;
end $$;

create function private.set_game_state(p_game uuid, p_status text, p_round int, p_race_seed bigint) returns public.games
language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  perform private.assert_host(p_game);
  update public.games set status = p_status, round = p_round, race_seed = p_race_seed
    where id = p_game returning * into g;
  return g;
end $$;

create function private.eliminate(p_game uuid, p_round int, p_slots int[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_host(p_game);
  update public.marbles set eliminated_round = p_round
    where game_id = p_game and slot = any (p_slots) and eliminated_round is null;
end $$;

-- Busted players get topped back up so they can keep playing.
create function private.bailout(p_game uuid, p_floor int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_host(p_game);
  update public.players set balance = p_floor where game_id = p_game and balance < p_floor;
end $$;

-- ---------------------------------------------------------------- public RPC surface

create function public.create_game(p_config jsonb) returns public.games
language sql security invoker set search_path = '' as $$ select private.create_game(p_config) $$;
create function public.join_game(p_code text, p_nickname text) returns public.players
language sql security invoker set search_path = '' as $$ select private.join_game(p_code, p_nickname) $$;
create function public.place_bet(p_market uuid, p_option text, p_amount int) returns public.bets
language sql security invoker set search_path = '' as $$ select private.place_bet(p_market, p_option, p_amount) $$;
create function public.open_market(p_game uuid, p_round int, p_kind text, p_question text, p_options jsonb, p_winners_expected int, p_window_seconds int) returns public.markets
language sql security invoker set search_path = '' as $$ select private.open_market(p_game, p_round, p_kind, p_question, p_options, p_winners_expected, p_window_seconds) $$;
create function public.lock_markets(p_ids uuid[]) returns void
language sql security invoker set search_path = '' as $$ select private.lock_markets(p_ids) $$;
create function public.settle_market(p_market uuid, p_winners text[]) returns public.markets
language sql security invoker set search_path = '' as $$ select private.settle_market(p_market, p_winners) $$;
create function public.void_market(p_market uuid) returns void
language sql security invoker set search_path = '' as $$ select private.void_market(p_market) $$;
create function public.set_game_state(p_game uuid, p_status text, p_round int, p_race_seed bigint) returns public.games
language sql security invoker set search_path = '' as $$ select private.set_game_state(p_game, p_status, p_round, p_race_seed) $$;
create function public.eliminate(p_game uuid, p_round int, p_slots int[]) returns void
language sql security invoker set search_path = '' as $$ select private.eliminate(p_game, p_round, p_slots) $$;
create function public.bailout(p_game uuid, p_floor int) returns void
language sql security invoker set search_path = '' as $$ select private.bailout(p_game, p_floor) $$;

-- Functions are executable by PUBLIC by default; restrict to signed-in (incl. anonymous) users.
revoke execute on all functions in schema private from public, anon;
revoke execute on function
  public.create_game, public.join_game, public.place_bet, public.open_market, public.lock_markets,
  public.settle_market, public.void_market, public.set_game_state, public.eliminate, public.bailout
  from public, anon;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;
grant execute on function
  public.create_game, public.join_game, public.place_bet, public.open_market, public.lock_markets,
  public.settle_market, public.void_market, public.set_game_state, public.eliminate, public.bailout
  to authenticated;

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table public.games, public.players, public.marbles, public.markets, public.bets;
