import type { Bet, Market } from "./types";

/** Real money staked on each option. */
export function poolsFor(market: Pick<Market, "id" | "options">, bets: Pick<Bet, "market_id" | "option" | "amount">[]) {
  const pools = new Map<string, number>(market.options.map((o) => [o.key, 0]));
  for (const b of bets) if (b.market_id === market.id) pools.set(b.option, (pools.get(b.option) ?? 0) + b.amount);
  return pools;
}

/** Whole pot, including the virtual seed on every option. Mirrors private.settle_market. */
export function potSize(market: Pick<Market, "options" | "seed_pool">, pools: Map<string, number>) {
  let total = market.seed_pool * market.options.length;
  for (const v of pools.values()) total += v;
  return total;
}

/**
 * Payout multiplier if `option` wins (stake × multiplier = return).
 * For multi-winner markets (e.g. 4 marbles eliminated) the other winners are assumed to be average options.
 */
export function multiplier(market: Pick<Market, "options" | "seed_pool" | "winners_expected">, pools: Map<string, number>, option: string) {
  const total = potSize(market, pools);
  const mine = (pools.get(option) ?? 0) + market.seed_pool;
  const others = Math.max(0, market.winners_expected - 1) * ((total - mine) / Math.max(1, market.options.length - 1));
  return total / (mine + others);
}

/** Exact settlement payout for one bet. Mirrors private.settle_market. */
export function settlePayout(
  market: Pick<Market, "options" | "seed_pool">,
  pools: Map<string, number>,
  winners: string[],
  bet: Pick<Bet, "option" | "amount">,
) {
  if (!winners.includes(bet.option)) return 0;
  const total = potSize(market, pools);
  const win = winners.reduce((s, w) => s + (pools.get(w) ?? 0), 0) + market.seed_pool * winners.length;
  return Math.floor((bet.amount * total) / win);
}

export const formatMultiplier = (x: number) => (x >= 10 ? `${x.toFixed(0)}×` : `${x.toFixed(1)}×`);
