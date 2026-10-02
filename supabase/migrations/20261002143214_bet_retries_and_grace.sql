-- Make bet placement safe to retry and forgiving of network latency.
--
-- Phones (especially iOS Safari after switching back from the Zoom app) often lose the first
-- request on a stale connection. Clients now send a client-generated id with each bet and retry
-- on network failure; a retried request returns the original bet instead of placing it twice.
-- Bets that arrive up to BET_GRACE after a live prop's cutoff (already in flight when it closed)
-- are still accepted.

alter table public.bets add column client_id uuid unique;

drop function public.place_bet(uuid, text, int);
drop function private.place_bet(uuid, text, int);

create function private.place_bet(p_market uuid, p_option text, p_amount int, p_client_id uuid default null)
returns public.bets
language plpgsql security definer set search_path = '' as $$
declare
  m public.markets;
  p public.players;
  b public.bets;
  grace constant interval := interval '2 seconds';
begin
  -- Retry of a bet that already went through: hand back the original.
  if p_client_id is not null then
    select * into b from public.bets where client_id = p_client_id;
    if b.id is not null then
      if b.player_id not in (select id from public.players where user_id = (select auth.uid())) then
        raise exception 'bet id already used';
      end if;
      return b;
    end if;
  end if;

  select * into m from public.markets where id = p_market;
  if m.id is null then raise exception 'market not found'; end if;
  if m.status = 'settled' or m.status = 'void'
     or (m.closes_at is not null and now() >= m.closes_at + grace)
     or (m.status = 'locked' and m.closes_at is null) then
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
  insert into public.bets (market_id, game_id, player_id, option, amount, client_id)
    values (m.id, m.game_id, p.id, p_option, p_amount, p_client_id) returning * into b;
  return b;
end $$;

create function public.place_bet(p_market uuid, p_option text, p_amount int, p_client_id uuid default null)
returns public.bets
language sql security invoker set search_path = '' as $$
  select private.place_bet(p_market, p_option, p_amount, p_client_id)
$$;

revoke execute on function private.place_bet(uuid, text, int, uuid) from public, anon;
revoke execute on function public.place_bet(uuid, text, int, uuid) from public, anon;
grant execute on function private.place_bet(uuid, text, int, uuid) to authenticated;
grant execute on function public.place_bet(uuid, text, int, uuid) to authenticated;
