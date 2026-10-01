import type { Bet, Market, Player } from "@/lib/game/types";

/** Stakes still riding on unsettled markets, by player. */
export function inPlayByPlayer(bets: Bet[], markets: Market[]) {
  const live = new Set(markets.filter((m) => m.status === "open" || m.status === "locked").map((m) => m.id));
  const out = new Map<string, number>();
  for (const b of bets) if (live.has(b.market_id)) out.set(b.player_id, (out.get(b.player_id) ?? 0) + b.amount);
  return out;
}

export function rankPlayers(players: Player[], bets: Bet[], markets: Market[]) {
  const inPlay = inPlayByPlayer(bets, markets);
  return [...players]
    .map((p) => ({ ...p, inPlay: inPlay.get(p.id) ?? 0, total: p.balance + (inPlay.get(p.id) ?? 0) }))
    .sort((a, b) => b.total - a.total || a.nickname.localeCompare(b.nickname));
}

export function Leaderboard({
  players,
  bets,
  markets,
  highlight,
  limit,
  size = "md",
}: {
  players: Player[];
  bets: Bet[];
  markets: Market[];
  highlight?: string;
  limit?: number;
  size?: "md" | "lg";
}) {
  const ranked = rankPlayers(players, bets, markets).slice(0, limit);
  if (!ranked.length) return <p className="text-sm text-muted">No players yet.</p>;
  return (
    <ol className="flex flex-col gap-1">
      {ranked.map((p, i) => (
        <li
          key={p.id}
          className={`flex items-center gap-3 rounded-lg px-3 ${size === "lg" ? "py-2 text-lg" : "py-1.5"} ${
            p.id === highlight ? "bg-lime/15 ring-1 ring-lime/60" : "bg-panel-2/70"
          }`}
        >
          <span className={`font-display w-6 text-right font-bold tabular ${i === 0 ? "text-gold" : "text-muted"}`}>{i + 1}</span>
          <span className="flex-1 truncate font-semibold">{p.nickname}</span>
          {p.inPlay > 0 && <span className="text-xs text-muted tabular">{p.inPlay} in play</span>}
          <span className="font-display font-bold tabular text-lime">{p.balance.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
