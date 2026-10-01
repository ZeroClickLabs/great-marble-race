"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Leaderboard, rankPlayers } from "@/components/Leaderboard";
import { MarbleChip, MarbleDot } from "@/components/MarbleChip";
import { MarketCard, isBettable } from "@/components/play/MarketCard";
import { joinGame, placeBet } from "@/lib/game/api";
import { formatMultiplier, multiplier, poolsFor } from "@/lib/game/odds";
import { CAPTION_MS, type Bet, type Market, type RaceTick } from "@/lib/game/types";
import { useGame } from "@/lib/game/useGame";
import { useStoredNickname } from "@/lib/game/useStoredNickname";
import { useNow, useRaceFeed } from "@/lib/game/useRaceFeed";
import { marbleBySlot } from "@/lib/race/marbles";
import { errorMessage } from "@/lib/supabase/client";

type Tab = "bet" | "mine" | "board";

export default function PlayGame({ code }: { code: string }) {
  const g = useGame(code);
  const localNow = useNow();
  const now = localNow + g.clockOffset;
  const { tick, captions } = useRaceFeed(g.game?.id);
  const [tab, setTab] = useState<Tab>("bet");
  const [pickedSlip, setSlip] = useState<{ marketId: string; option: string } | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  // Buzz the phone when a live prop opens; it is only open for a few seconds.
  const liveProp = g.markets.find((m) => m.kind === "prop" && isBettable(m, now));
  useEffect(() => {
    if (liveProp) navigator.vibrate?.([120, 60, 120]);
  }, [liveProp?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = g.players.find((p) => p.user_id === g.userId);
  const myBets = useMemo(() => g.bets.filter((b) => b.player_id === me?.id), [g.bets, me?.id]);
  const openMarkets = g.markets.filter((m) => isBettable(m, now));
  // Live props first, then race markets, then the long-term champion market.
  const order: Record<Market["kind"], number> = { prop: 0, round_winner: 1, round_elim: 2, outright: 3 };
  const visible = [...openMarkets].sort((a, b) => order[a.kind] - order[b.kind] || b.created_at.localeCompare(a.created_at));
  const slipMarket = pickedSlip ? g.markets.find((m) => m.id === pickedSlip.marketId) : undefined;
  // The slip disappears by itself if its market closes underneath us.
  const slip = slipMarket && isBettable(slipMarket, now) ? pickedSlip : null;

  if (g.phase === "loading") return <Splash text="Loading…" />;
  if (g.phase === "error") return <Splash text={g.error ?? "Something went wrong"} />;
  if (g.phase === "not_member" || !g.game || !me) return <JoinForm code={code} onJoined={g.reload} />;

  const game = g.game;
  const totalRounds = game.config.eliminations.length;
  const rank = rankPlayers(g.players, g.bets, g.markets).findIndex((p) => p.id === me.id) + 1;
  const roundNet = netForRound(g.markets, myBets, game.round);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col pb-24">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted">
          <span>
            {me.nickname} · #{rank} of {g.players.length}
          </span>
          <span>
            {game.status === "finished" ? "Final" : `Race ${game.round}/${totalRounds}`} · <StatusPill status={game.status} />
          </span>
        </div>
        <div className="mt-1 flex items-end justify-between">
          <div className="font-display text-5xl font-extrabold leading-none tabular text-lime">
            {me.balance.toLocaleString()}
            <span className="ml-1.5 text-base font-bold text-muted">MB</span>
          </div>
          {(game.status === "results" || game.status === "finished") && roundNet !== 0 && (
            <div className={`font-display pop-in text-2xl font-bold tabular ${roundNet > 0 ? "text-lime" : "text-danger"}`}>
              {roundNet > 0 ? "+" : ""}
              {roundNet} this race
            </div>
          )}
        </div>
      </header>

      {game.status === "racing" && tick && tick.round === game.round && <LiveTicker tick={tick} myBets={myBets} markets={g.markets} />}
      {game.status === "racing" && captions[0] && localNow - captions[0].at < CAPTION_MS && (
        <p key={captions[0].id} className="pop-in mx-4 mt-3 rounded-lg bg-panel-2 px-3 py-2 text-sm font-semibold">
          🎙️ {captions[0].text}
        </p>
      )}

      {liveProp && tab !== "bet" && (
        <button
          onClick={() => {
            setTab("bet");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="pop-in font-display mx-4 mt-3 rounded-xl bg-pink px-4 py-3 text-left text-lg font-bold uppercase text-ink"
        >
          ⚡ Live prop: {liveProp.question} Tap to bet
        </button>
      )}

      <main className="flex flex-1 flex-col gap-3 px-4 pt-4">
        {tab === "bet" && (
          <>
            {game.status === "finished" && <ChampionCard markets={g.markets} />}
            {visible.length === 0 && game.status !== "finished" && (
              <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-muted">
                {game.status === "racing" ? "Live props pop up here during the race. Stay ready!" : "Betting opens before the next race."}
              </p>
            )}
            {visible.map((m) => (
              <MarketCard
                key={m.id}
                market={m}
                bets={g.bets}
                myBets={myBets.filter((b) => b.market_id === m.id)}
                now={now}
                selected={slip?.marketId === m.id ? slip.option : null}
                onSelect={(option) => setSlip(slip?.marketId === m.id && slip.option === option ? null : { marketId: m.id, option })}
              />
            ))}
          </>
        )}
        {tab === "mine" && <MyBets markets={g.markets} myBets={myBets} />}
        {tab === "board" && <Leaderboard players={g.players} bets={g.bets} markets={g.markets} highlight={me.id} />}
      </main>

      {slip && slipMarket && (
        <BetSlip
          key={`${slip.marketId}:${slip.option}`}
          market={slipMarket}
          option={slip.option}
          bets={g.bets}
          balance={me.balance}
          onClose={() => setSlip(null)}
          onPlaced={(text) => {
            setSlip(null);
            setToast({ text });
          }}
          onError={(text) => setToast({ text, bad: true })}
        />
      )}

      {toast && (
        <div
          className={`pop-in fixed inset-x-4 top-24 z-40 mx-auto max-w-sm rounded-xl px-4 py-3 text-center font-semibold shadow-xl ${
            toast.bad ? "bg-danger text-white" : "bg-lime text-ink"
          }`}
        >
          {toast.text}
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-3">
          {(
            [
              ["bet", `Bet${openMarkets.length ? ` (${openMarkets.length})` : ""}`],
              ["mine", "My bets"],
              ["board", "Leaderboard"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`py-4 text-sm font-bold uppercase tracking-wide ${tab === key ? "text-lime" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function netForRound(markets: Market[], myBets: Bet[], round: number) {
  const settled = new Set(markets.filter((m) => m.round === round && m.status === "settled").map((m) => m.id));
  return myBets.filter((b) => settled.has(b.market_id)).reduce((sum, b) => sum + (b.payout ?? 0) - b.amount, 0);
}

function StatusPill({ status }: { status: string }) {
  const label = { lobby: "Lobby", betting: "Betting open", racing: "LIVE", results: "Results", finished: "Finished" }[status] ?? status;
  return <span className={status === "racing" ? "text-danger" : status === "betting" || status === "lobby" ? "text-lime" : ""}>{label}</span>;
}

function Splash({ text }: { text: string }) {
  return <div className="flex flex-1 items-center justify-center p-8 text-center text-muted">{text}</div>;
}

function JoinForm({ code, onJoined }: { code: string; onJoined: () => void }) {
  const [nickname, setNickname, rememberNickname] = useStoredNickname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await joinGame(code, nickname);
          rememberNickname(nickname);
          onJoined();
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <div className="text-sm font-bold uppercase tracking-widest text-muted">Joining game</div>
      <div className="font-display text-6xl font-extrabold tracking-[0.2em] text-lime">{code.toUpperCase()}</div>
      <input
        required
        autoFocus
        maxLength={24}
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        placeholder="Your name"
        className="rounded-xl border border-line bg-panel px-4 py-4 text-xl outline-none focus:border-lime"
      />
      {error && <p className="text-danger">{error}</p>}
      <button disabled={busy} className="font-display rounded-xl bg-lime py-4 text-2xl font-bold uppercase text-ink disabled:opacity-60">
        {busy ? "Joining…" : "Let me in"}
      </button>
      <Link href="/" className="text-center text-sm text-muted underline">
        Wrong game?
      </Link>
    </form>
  );
}

function BetSlip({
  market,
  option,
  bets,
  balance,
  onClose,
  onPlaced,
  onError,
}: {
  market: Market;
  option: string;
  bets: Bet[];
  balance: number;
  onClose: () => void;
  onPlaced: (text: string) => void;
  onError: (text: string) => void;
}) {
  const chips = [10, 25, 50, 100, 250].filter((c) => c <= balance);
  const [amount, setAmount] = useState(Math.min(50, balance));
  const [busy, setBusy] = useState(false);
  const opt = market.options.find((o) => o.key === option)!;
  // Odds after our own stake joins the pool.
  const pools = poolsFor(market, bets);
  pools.set(option, (pools.get(option) ?? 0) + amount);
  const x = multiplier(market, pools, option);

  return (
    <div className="pop-in fixed inset-x-0 bottom-[57px] z-30 border-t-2 border-lime bg-panel px-4 pb-4 pt-3 shadow-[0_-12px_40px_rgba(0,0,0,0.5)]">
      <div className="mx-auto flex max-w-md flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="truncate text-xs uppercase tracking-wider text-muted">{market.question}</div>
            <div className="font-display flex items-center gap-2 text-2xl font-bold">
              {opt.slot !== undefined && <MarbleDot slot={opt.slot} size={20} />}
              {opt.label}
            </div>
          </div>
          <button onClick={onClose} className="rounded-full bg-ink px-3 py-1 text-sm text-muted" aria-label="Close bet slip">
            ✕
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c}
              onClick={() => setAmount(c)}
              className={`rounded-full px-4 py-2 font-bold tabular ${amount === c ? "bg-lime text-ink" : "bg-ink text-text"}`}
            >
              {c}
            </button>
          ))}
          <button
            onClick={() => setAmount(balance)}
            className={`rounded-full px-4 py-2 font-bold ${amount === balance ? "bg-pink text-ink" : "bg-ink text-pink"}`}
          >
            All in
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={balance}
            value={amount || ""}
            onChange={(e) => setAmount(Math.max(0, Math.min(balance, Math.floor(Number(e.target.value)))))}
            className="w-24 rounded-full border border-line bg-ink px-4 py-2 text-right font-bold tabular outline-none focus:border-lime"
            aria-label="Custom amount"
          />
        </div>
        <button
          disabled={busy || amount <= 0 || amount > balance}
          onClick={async () => {
            setBusy(true);
            try {
              await placeBet(market.id, option, amount);
              onPlaced(`${amount} on ${opt.label} ✓`);
            } catch (e) {
              onError(errorMessage(e));
              setBusy(false);
            }
          }}
          className="font-display flex items-center justify-between rounded-xl bg-lime px-5 py-3 text-xl font-bold uppercase text-ink disabled:opacity-50"
        >
          <span>{busy ? "Placing…" : `Bet ${amount}`}</span>
          <span className="text-base normal-case">
            pays ~{Math.floor(amount * x).toLocaleString()} ({formatMultiplier(x)})
          </span>
        </button>
      </div>
    </div>
  );
}

function LiveTicker({ tick, myBets, markets }: { tick: RaceTick; myBets: Bet[]; markets: Market[] }) {
  // Highlight marbles this player has money on in the current race.
  const live = new Set(markets.filter((m) => m.status !== "settled" && m.status !== "void").map((m) => m.id));
  const backed = new Set(
    myBets
      .filter((b) => live.has(b.market_id))
      .map((b) => markets.find((m) => m.id === b.market_id)?.options.find((o) => o.key === b.option)?.slot)
      .filter((s): s is number => s !== undefined),
  );
  const cut = tick.standings.length - tick.eliminate;
  const rows = tick.standings
    .map((slot, i) => ({ slot, i }))
    .filter(({ slot, i }) => i < 3 || backed.has(slot) || i === cut - 1 || i === cut);
  return (
    <div className="mx-4 mt-3 rounded-2xl border border-danger/40 bg-panel p-3">
      <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-widest">
        <span className="text-danger">● Live · {tick.time.toFixed(0)}s</span>
        <span className="text-muted">{tick.eliminate} knocked out</span>
      </div>
      <ol className="flex flex-col gap-1">
        {rows.map(({ slot, i }) => (
          <li
            key={slot}
            className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${i >= cut ? "bg-danger/20" : "bg-ink/60"} ${
              backed.has(slot) ? "ring-1 ring-lime" : ""
            }`}
          >
            <span className="font-display w-5 text-right font-bold text-muted tabular">{i + 1}</span>
            <MarbleChip slot={slot} className="flex-1 font-semibold" />
            {tick.finished.includes(slot) ? (
              <span>🏁</span>
            ) : (
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-ink">
                <span className="block h-full bg-lime" style={{ width: `${(tick.progress[slot] ?? 0) * 100}%` }} />
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function MyBets({ markets, myBets }: { markets: Market[]; myBets: Bet[] }) {
  if (!myBets.length) return <p className="py-8 text-center text-muted">No bets yet. Fortune favours the bold.</p>;
  const byId = new Map(markets.map((m) => [m.id, m]));
  const sorted = [...myBets].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((b) => {
        const m = byId.get(b.market_id);
        const opt = m?.options.find((o) => o.key === b.option);
        const settled = m?.status === "settled" || m?.status === "void";
        const won = (b.payout ?? 0) > 0;
        return (
          <li key={b.id} className="flex items-center gap-3 rounded-xl bg-panel px-3 py-2">
            {opt?.slot !== undefined ? <MarbleDot slot={opt.slot} size={18} /> : <span className="w-[18px]" />}
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{opt?.label ?? b.option}</div>
              <div className="truncate text-xs text-muted">
                R{m?.round} · {m?.question}
              </div>
            </div>
            <div className="text-right tabular">
              <div className="text-sm">{b.amount}</div>
              <div className={`text-xs font-bold ${!settled ? "text-muted" : won ? "text-lime" : "text-danger"}`}>
                {!settled ? "pending" : m?.status === "void" ? "refunded" : won ? `+${b.payout}` : "lost"}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ChampionCard({ markets }: { markets: Market[] }) {
  const outright = markets.find((m) => m.kind === "outright" && m.status === "settled" && m.result?.length);
  const slot = outright?.result ? Number(outright.result[0]) : null;
  if (slot === null) return null;
  return (
    <div className="pop-in flex flex-col items-center gap-2 rounded-2xl border border-gold bg-gold/10 p-6 text-center">
      <div className="text-xs font-bold uppercase tracking-widest text-gold">Champion</div>
      <MarbleDot slot={slot} size={64} />
      <div className="font-display text-4xl font-extrabold">{marbleBySlot(slot).name}</div>
    </div>
  );
}
