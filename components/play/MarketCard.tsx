"use client";

import { MarbleDot } from "@/components/MarbleChip";
import { formatMultiplier, multiplier, poolsFor } from "@/lib/game/odds";
import type { Bet, Market } from "@/lib/game/types";

const KIND_LABEL: Record<Market["kind"], string> = {
  outright: "Champion",
  round_winner: "Race winner",
  round_elim: "Elimination",
  prop: "Live prop",
};

export function secondsLeft(market: Market, now: number) {
  if (!market.closes_at) return null;
  return Math.max(0, (new Date(market.closes_at).getTime() - now) / 1000);
}

export function isBettable(market: Market, now: number) {
  const left = secondsLeft(market, now);
  return market.status === "open" && (left === null || left > 0);
}

export function MarketCard({
  market,
  bets,
  myBets,
  now,
  selected,
  onSelect,
}: {
  market: Market;
  bets: Bet[];
  myBets: Bet[];
  now: number;
  selected?: string | null;
  onSelect?: (option: string) => void;
}) {
  const pools = poolsFor(market, bets);
  const open = isBettable(market, now);
  const left = secondsLeft(market, now);
  const isProp = market.kind === "prop";
  const myStake = new Map<string, number>();
  for (const b of myBets) myStake.set(b.option, (myStake.get(b.option) ?? 0) + b.amount);
  const totalWindow = market.closes_at ? (new Date(market.closes_at).getTime() - new Date(market.created_at).getTime()) / 1000 : 0;

  return (
    <section
      className={`overflow-hidden rounded-2xl border ${isProp && open ? "border-pink bg-pink/10 pop-in" : "border-line bg-panel"} ${
        open ? "" : "opacity-80"
      }`}
    >
      {isProp && open && left !== null && (
        <div className="h-1.5 bg-pink/20">
          <div className="h-full bg-pink transition-[width] duration-200 ease-linear" style={{ width: `${(left / totalWindow) * 100}%` }} />
        </div>
      )}
      <header className="flex items-start justify-between gap-3 px-4 pt-3">
        <div>
          <div className={`text-[11px] font-bold uppercase tracking-widest ${isProp ? "text-pink" : "text-muted"}`}>{KIND_LABEL[market.kind]}</div>
          <h3 className="font-display text-xl font-bold leading-tight">{market.question}</h3>
        </div>
        <span className="shrink-0 pt-1 text-xs font-semibold uppercase tabular">
          {market.status === "settled" ? (
            <span className="text-muted">Settled</span>
          ) : open ? (
            left !== null ? <span className="text-pink">{Math.ceil(left)}s</span> : <span className="text-lime">Open</span>
          ) : (
            <span className="text-muted">Locked</span>
          )}
        </span>
      </header>
      {/* Big marble fields go two-up so a 16-marble market fits on one phone screen. */}
      <ul className={`grid gap-1 p-2 ${market.options.length > 4 ? "grid-cols-2" : "grid-cols-1"}`}>
        {market.options.map((o) => {
          const won = market.result?.includes(o.key);
          const mine = myStake.get(o.key);
          const active = selected === o.key;
          return (
            <li key={o.key}>
              <button
                disabled={!open}
                onClick={() => onSelect?.(o.key)}
                className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left transition ${
                  active ? "bg-lime text-ink" : won ? "bg-lime/15 ring-1 ring-lime" : "bg-ink/50 enabled:hover:bg-panel-2"
                }`}
              >
                {o.slot !== undefined ? <MarbleDot slot={o.slot} size={20} /> : <span className="w-5 text-center">{o.key === "yes" ? "👍" : o.key === "no" ? "👎" : "❔"}</span>}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{o.label}</span>
                {mine && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular ${active ? "bg-ink/20" : "bg-lime/20 text-lime"}`}>
                    {mine}
                  </span>
                )}
                {won && <span className="text-xs font-bold">✓</span>}
                <span className={`font-display text-right text-lg font-bold tabular ${active ? "" : "text-gold"}`}>
                  {formatMultiplier(multiplier(market, pools, o.key))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
