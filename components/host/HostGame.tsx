"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Leaderboard } from "@/components/Leaderboard";
import { MarbleChip, MarbleDot } from "@/components/MarbleChip";
import { isBettable, secondsLeft } from "@/components/play/MarketCard";
import type { RaceStageHandle } from "@/components/race/RaceStage";
import { Standings } from "@/components/race/Standings";
import { SoundControl } from "@/components/SoundControl";
import { playRaceEvent, raceIntensity, updateRaceAmbience, useRaceAudio } from "@/lib/audio/useRaceAudio";
import { fetchForms } from "@/lib/game/api";
import { advanceRound, eliminationsFor, RaceDirector } from "@/lib/game/director";
import { formatMultiplier, multiplier, poolsFor } from "@/lib/game/odds";
import { CAPTION_MS, type Bet, type Game, type MarbleRow, type Market, type Player, type RaceCaption } from "@/lib/game/types";
import { useGame } from "@/lib/game/useGame";
import { useNow, useRaceBroadcaster } from "@/lib/game/useRaceFeed";
import type { RaceEvent } from "@/lib/race/engine";
import { marbleBySlot } from "@/lib/race/marbles";
import { themeForRound } from "@/lib/race/themes";
import type { RaceSnapshot } from "@/lib/race/runner";
import { errorMessage } from "@/lib/supabase/client";

const RaceStage = dynamic(() => import("@/components/race/RaceStage"), { ssr: false });

const name = (slot: number) => marbleBySlot(slot).name;

export default function HostGame({ code }: { code: string }) {
  const g = useGame(code);
  const localNow = useNow(250);
  const now = localNow + g.clockOffset;
  const broadcast = useRaceBroadcaster(g.game?.id);
  const stage = useRef<RaceStageHandle>(null);
  const director = useRef<RaceDirector | null>(null);
  const marketsRef = useRef<Market[]>([]);
  const snapRef = useRef<RaceSnapshot | null>(null);
  const [snap, setSnap] = useState<RaceSnapshot | null>(null);
  const [forms, setForms] = useState<number[] | null>(null);
  const [stageReady, setStageReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [captions, setCaptions] = useState<RaceCaption[]>([]);
  const [lastOrder, setLastOrder] = useState<{ round: number; order: number[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const raceLive = useRef(false);
  const captionId = useRef(0);
  const lastBoostCaption = useRef(-10);
  const lastDangerCaption = useRef<{ slot: number; t: number }>({ slot: -1, t: -10 });
  const lastBroadcast = useRef(0);
  const announcedProps = useRef(new Set<string>());

  useEffect(() => {
    marketsRef.current = g.markets;
  }, [g.markets]);

  const game = g.game;
  const isHost = !!game && game.host_id === g.userId;

  useEffect(() => {
    if (game?.id && isHost) fetchForms(game.id).then(setForms);
  }, [game?.id, isHost]);

  const round = game?.round ?? 1;
  const elim = game ? eliminationsFor(game, round) : 0;
  // Marbles that started this round (stays stable on the results screen after eliminations land).
  const field = useMemo(
    () => g.marbles.filter((m) => m.eliminated_round === null || m.eliminated_round >= round).map((m) => m.slot).sort((a, b) => a - b),
    [g.marbles, round],
  );
  const entrants = useMemo(() => (forms ? field.map((slot) => ({ slot, form: forms[slot] ?? 0 })) : []), [field, forms]);
  const finalRace = field.length - elim === 1;

  // Music follows the race's theme: calm while betting, full band while racing, finale near the line.
  const audio = useRaceAudio(
    game ? themeForRound(game, round).key : null,
    game?.status === "racing" ? raceIntensity(true, snap, finalRace) : game?.status === "finished" ? 1 : 0,
  );
  const sfx = audio.engine;
  const championPlayed = useRef(false);
  useEffect(() => {
    if (game?.status === "finished" && !championPlayed.current) {
      championPlayed.current = true;
      sfx?.champion();
    }
  }, [game?.status, sfx]);

  const say = useCallback(
    (text: string, tone?: RaceCaption["tone"]) => {
      const c = { id: ++captionId.current, text, tone, at: Date.now() };
      setCaptions((cs) => [c, ...cs].slice(0, 5));
      broadcast.caption(c);
    },
    [broadcast],
  );

  // Announce live props as they open.
  useEffect(() => {
    for (const m of g.markets) {
      if (m.kind !== "prop" || m.status !== "open" || announcedProps.current.has(m.id)) continue;
      announcedProps.current.add(m.id);
      if (raceLive.current) {
        say(`LIVE PROP: ${m.question} Bet now!`, "prop");
        sfx?.propOpened();
      }
    }
  }, [g.markets, say, sfx]);

  const onError = useCallback((e: unknown) => setError(errorMessage(e)), []);

  const startRace = useCallback(async () => {
    if (!game || busy) return;
    setBusy(true);
    setError(null);
    director.current = new RaceDirector(game, round, field, () => marketsRef.current, onError);
    try {
      await director.current.beginRace();
    } catch (e) {
      onError(e);
    }
    setBusy(false);
    for (const n of [3, 2, 1]) {
      setCountdown(n);
      sfx?.countdownBeep();
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCountdown(0);
    sfx?.go();
    raceLive.current = true;
    stage.current?.start();
    setTimeout(() => setCountdown(null), 900);
  }, [game, busy, round, field, onError, sfx]);

  const onEvent = useCallback(
    (e: RaceEvent) => {
      director.current?.handle(e);
      // The final's loser isn't "knocked out" — the champion fanfare covers that moment.
      playRaceEvent(sfx, e, finalRace ? 0 : elim);
      switch (e.type) {
        case "start":
          say("And they're off!");
          break;
        case "lead_change":
          say(`${name(e.leader)} takes the lead from ${name(e.previous)}!`, "lead");
          break;
        case "checkpoint":
          say(`${name(e.leader)} leads at Checkpoint ${e.index + 1}`, "lead");
          break;
        case "boost":
          if ((snapRef.current?.time ?? 0) - lastBoostCaption.current > 6) {
            lastBoostCaption.current = snapRef.current?.time ?? 0;
            say(`${name(e.slot)} hits the boost pad! ⚡`);
          }
          break;
        case "finished": {
          const safeSpots = field.length - elim;
          if (e.place === 1) say(`${name(e.slot)} wins Race ${round}! 🏆`, "finish");
          else if (e.place === safeSpots && elim > 0) say(`${name(e.slot)} grabs the last safe spot!`, "finish");
          break;
        }
        case "race_over":
          raceLive.current = false;
          setLastOrder({ round, order: e.order });
          if (elim > 0 && field.length - elim > 1) say(`Knocked out: ${e.order.slice(-elim).map(name).join(", ")} 💥`, "danger");
          break;
      }
    },
    [say, field.length, elim, round, sfx, finalRace],
  );

  const onTick = useCallback(
    (s: RaceSnapshot) => {
      snapRef.current = s;
      setSnap(s);
      updateRaceAmbience(sfx, s);
      if (s.phase !== "running") return;
      if (s.time > 3) director.current?.openOpeningProp(s.standings);
      // Commentary when the elimination line changes hands.
      const cut = s.standings.length - elim;
      const bubble = s.standings[cut];
      if (elim > 0 && bubble !== undefined && s.time > 10 && !s.finished.includes(bubble)) {
        const last = lastDangerCaption.current;
        if (bubble !== last.slot && s.time - last.t > 6) {
          lastDangerCaption.current = { slot: bubble, t: s.time };
          say(`${name(bubble)} drops into the danger zone!`, "danger");
        }
      }
      if (game && performance.now() - lastBroadcast.current > 450) {
        lastBroadcast.current = performance.now();
        broadcast.tick({ round, time: s.time, standings: s.standings, finished: s.finished, progress: s.progress, eliminate: elim });
      }
    },
    [broadcast, elim, game, round, say, sfx],
  );

  if (g.phase === "loading") return <Center>Loading…</Center>;
  if (g.phase !== "ready" || !game) return <Center>Game {code} not found.</Center>;
  if (!isHost)
    return (
      <Center>
        <p>This is the host screen.</p>
        <Link className="text-lime underline" href={`/play/${code}`}>
          Open the player view
        </Link>
      </Center>
    );

  const pre = game.status === "lobby" || game.status === "betting";
  // Host reloaded mid-race: the race is replayed from its seed (same result), so offer to resume it.
  const needsResume = game.status === "racing" && (!snap || snap.phase === "grid");

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-ink">
      {game.race_seed !== null && entrants.length > 0 && (
        <RaceStage
          key={`${round}:${game.race_seed}`}
          ref={stage}
          seed={game.race_seed}
          theme={themeForRound(game, round).key}
          entrants={entrants}
          eliminate={elim}
          onReady={() => setStageReady(true)}
          onEvent={onEvent}
          onTick={onTick}
        />
      )}

      <TopBar
        game={game}
        code={code}
        snap={snap}
        live={game.status === "racing"}
        sound={
          <SoundControl
            unlocked={audio.unlocked}
            muted={audio.prefs.muted}
            volume={audio.prefs.volume}
            onMuted={audio.setMuted}
            onVolume={audio.setVolume}
          />
        }
      />

      {pre && (
        <PreRace
          game={game}
          code={code}
          field={field}
          elim={elim}
          markets={g.markets}
          bets={g.bets}
          players={g.players}
          now={now}
          canStart={stageReady && !busy && countdown === null}
          onStart={startRace}
        />
      )}

      {game.status === "racing" && (
        <>
          {snap && snap.phase !== "grid" && (
            <div className="absolute left-4 top-20">
              <Standings snap={snap} eliminate={elim} />
            </div>
          )}
          <LiveProps markets={g.markets.filter((m) => m.kind === "prop" && m.round === round)} bets={g.bets} now={now} />
          {snap?.phase === "done" && (
            <div className="pop-in font-display absolute left-1/2 top-24 -translate-x-1/2 rounded-xl bg-ink/90 px-6 py-3 text-2xl font-bold uppercase">
              Checking the photo finish… settling bets
            </div>
          )}
          {needsResume && countdown === null && (
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                onClick={startRace}
                disabled={!stageReady}
                className="font-display rounded-2xl bg-lime px-10 py-5 text-4xl font-extrabold uppercase text-ink shadow-2xl"
              >
                Resume race {round}
              </button>
            </div>
          )}
        </>
      )}

      {game.status === "racing" && captions[0] && localNow - captions[0].at < CAPTION_MS && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
          <div
            key={captions[0].id}
            className={`pop-in font-display rounded-xl px-6 py-3 text-3xl font-bold uppercase shadow-2xl ${
              captions[0].tone === "prop"
                ? "bg-pink text-ink"
                : captions[0].tone === "danger"
                  ? "bg-danger text-white"
                  : captions[0].tone === "finish"
                    ? "bg-gold text-ink"
                    : "bg-ink/85 text-text"
            }`}
          >
            {captions[0].text}
          </div>
        </div>
      )}

      {game.status === "results" && (
        <Results
          game={game}
          marbles={g.marbles}
          markets={g.markets}
          bets={g.bets}
          players={g.players}
          order={lastOrder?.round === round ? lastOrder.order : null}
          busy={busy}
          onNext={async () => {
            setBusy(true);
            setError(null);
            setStageReady(false);
            setSnap(null);
            setCaptions([]);
            try {
              await advanceRound(game, g.marbles.filter((m) => m.eliminated_round === null).map((m) => m.slot));
            } catch (e) {
              onError(e);
            }
            setBusy(false);
          }}
        />
      )}

      {game.status === "finished" && <Champion markets={g.markets} bets={g.bets} players={g.players} />}

      {countdown !== null && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div key={countdown} className="pop-in font-display text-[16rem] font-extrabold leading-none text-lime drop-shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
            {countdown === 0 ? "GO!" : countdown}
          </div>
        </div>
      )}

      {error && (
        <button onClick={() => setError(null)} className="absolute bottom-4 left-4 max-w-md rounded-lg bg-danger px-4 py-2 text-left text-sm text-white">
          {error} (click to dismiss)
        </button>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-dvh flex-col items-center justify-center gap-3 text-muted">{children}</div>;
}

function TopBar({
  game,
  code,
  snap,
  live,
  sound,
}: {
  game: Game;
  code: string;
  snap: RaceSnapshot | null;
  live: boolean;
  sound: React.ReactNode;
}) {
  const total = game.config.eliminations.length;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4">
      <div className="font-display flex items-center gap-3 rounded-xl bg-ink/85 px-4 py-2 text-2xl font-bold uppercase">
        <span className="text-lime">Great Marble Race</span>
        <span className="text-muted">·</span>
        <span>{game.status === "finished" ? "Champion" : `Race ${game.round} of ${total}`}</span>
        {game.status !== "finished" && (
          <>
            <span className="text-muted">·</span>
            <span style={{ color: themeForRound(game, game.round).accent }}>{themeForRound(game, game.round).name}</span>
          </>
        )}
        {live && snap && snap.phase !== "grid" && (
          <>
            <span className="text-muted">·</span>
            <span className="tabular text-danger">● {snap.time.toFixed(1)}s</span>
            {snap.slowMo && <span className="rounded bg-pink px-2 text-base text-ink">SLOW-MO</span>}
          </>
        )}
      </div>
      <div className="flex items-start gap-2">
        {sound}
        {game.status !== "lobby" && (
          <div className="font-display rounded-xl bg-ink/85 px-4 py-2 text-xl font-bold uppercase">
            Join: <span className="text-lime tracking-widest">{code}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PreRace({
  game,
  code,
  field,
  elim,
  markets,
  bets,
  players,
  now,
  canStart,
  onStart,
}: {
  game: Game;
  code: string;
  field: number[];
  elim: number;
  markets: Market[];
  bets: Bet[];
  players: Player[];
  now: number;
  canStart: boolean;
  onStart: () => void;
}) {
  const round = game.round;
  const mine = markets.filter((m) => m.round === round);
  const win = mine.find((m) => m.kind === "round_winner");
  const out = mine.find((m) => m.kind === "round_elim");
  const champ = mine.find((m) => m.kind === "outright");
  const odds = (m: Market | undefined, slot: number) => (m ? multiplier(m, poolsFor(m, bets), String(slot)) : null);
  const rows = field.map((slot) => ({ slot, win: odds(win, slot), out: odds(out, slot), champ: odds(champ, slot) })).sort((a, b) => (a.win ?? 0) - (b.win ?? 0));
  const openIds = new Set(mine.filter((m) => isBettable(m, now)).map((m) => m.id));
  const roundBets = bets.filter((b) => openIds.has(b.market_id));
  const pot = roundBets.reduce((s, b) => s + b.amount, 0);
  const bettors = new Set(roundBets.map((b) => b.player_id)).size;
  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/play/${code}` : "";
  const final = field.length - elim === 1;
  const theme = themeForRound(game, round);

  return (
    <>
      <div className="absolute left-4 top-20 bottom-4 flex w-[420px] flex-col gap-3 overflow-hidden rounded-2xl bg-ink/88 p-4 backdrop-blur">
        <div>
          <div className="text-sm font-bold uppercase tracking-widest" style={{ color: theme.accent }}>
            {theme.name}
          </div>
          <div className="font-display text-5xl font-extrabold uppercase leading-none">{final ? "The Grand Final" : `Race ${round}`}</div>
          <div className="text-sm text-muted">{theme.tagline}</div>
          <div className="mt-1 text-lg text-muted">
            {field.length} marbles ·{" "}
            <span className="font-bold text-danger">{final ? "winner takes the crown" : `bottom ${elim} knocked out`}</span>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_64px_64px_64px] gap-x-2 px-2 text-[11px] font-bold uppercase tracking-wider text-muted">
          <span>Marble</span>
          <span className="text-right">Win</span>
          <span className="text-right">{out ? "Out" : ""}</span>
          <span className="text-right">{champ ? "Champ" : ""}</span>
        </div>
        <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.slot} className="grid grid-cols-[1fr_64px_64px_64px] items-center gap-x-2 rounded-lg bg-panel-2/70 px-2 py-1.5">
              <MarbleChip slot={r.slot} className="min-w-0 font-semibold" />
              <span className="font-display text-right text-lg font-bold tabular text-gold">{r.win ? formatMultiplier(r.win) : ""}</span>
              <span className="font-display text-right text-lg font-bold tabular text-danger">{r.out ? formatMultiplier(r.out) : ""}</span>
              <span className="font-display text-right text-lg font-bold tabular text-lime">{r.champ ? formatMultiplier(r.champ) : ""}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="absolute right-4 top-20 bottom-4 flex w-[360px] flex-col gap-4 rounded-2xl bg-ink/88 p-4 backdrop-blur">
        <div className="flex items-center gap-4">
          <div className="rounded-xl bg-white p-2">
            <QRCodeSVG value={joinUrl} size={game.status === "lobby" ? 150 : 96} />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-widest text-muted">Join on your phone</div>
            <div className="font-display text-6xl font-extrabold tracking-widest text-lime">{code}</div>
            <div className="truncate text-xs text-muted">{joinUrl.replace(/^https?:\/\//, "")}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <Stat label="Pot this race" value={pot.toLocaleString()} />
          <Stat label="Punters in" value={`${bettors}/${players.length}`} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted">Leaderboard</div>
          <Leaderboard players={players} bets={bets} markets={markets} />
        </div>
        <button
          onClick={onStart}
          disabled={!canStart}
          className="font-display rounded-xl bg-lime px-5 py-4 text-3xl font-extrabold uppercase text-ink transition hover:brightness-110 disabled:opacity-50"
        >
          {canStart ? "Start race ▶" : "Loading track…"}
        </button>
        <p className="-mt-2 text-center text-xs text-muted">
          Betting locks when the race starts. On Zoom, tick <b className="text-text">Share sound</b> when sharing so everyone hears the race.
        </p>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-panel-2 px-3 py-2">
      <div className="font-display text-3xl font-bold tabular">{value}</div>
      <div className="text-[11px] font-bold uppercase tracking-widest text-muted">{label}</div>
    </div>
  );
}

function LiveProps({ markets, bets, now }: { markets: Market[]; bets: Bet[]; now: number }) {
  // Show open props, plus the most recently settled one briefly for the reveal.
  const open = markets.filter((m) => isBettable(m, now));
  const recent = markets
    .filter((m) => m.status === "settled")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 1);
  const shown = open.length ? open : recent;
  if (!shown.length) return null;
  return (
    <div className="absolute right-4 top-20 flex w-[380px] flex-col gap-3">
      {shown.map((m) => {
        const pools = poolsFor(m, bets);
        const left = secondsLeft(m, now);
        const isOpen = isBettable(m, now);
        const count = bets.filter((b) => b.market_id === m.id).length;
        return (
          <div key={m.id} className={`pop-in overflow-hidden rounded-2xl border-2 ${isOpen ? "border-pink bg-ink/90" : "border-lime bg-ink/90"}`}>
            <div className={`flex items-center justify-between px-4 py-2 ${isOpen ? "bg-pink text-ink" : "bg-lime text-ink"}`}>
              <span className="font-display text-xl font-extrabold uppercase">{isOpen ? "Live prop · bet now" : "Prop result"}</span>
              {isOpen && left !== null && <span className="font-display text-3xl font-extrabold tabular">{Math.ceil(left)}</span>}
            </div>
            <div className="p-3">
              <div className="font-display mb-2 text-2xl font-bold leading-tight">{m.question}</div>
              <ul className="flex flex-col gap-1">
                {m.options.map((o) => {
                  const won = m.result?.includes(o.key);
                  return (
                    <li key={o.key} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${won ? "bg-lime/20 ring-1 ring-lime" : "bg-panel-2/70"}`}>
                      {o.slot !== undefined && <MarbleDot slot={o.slot} size={14} />}
                      <span className="flex-1 truncate font-semibold">{o.label}</span>
                      {won && <span className="text-xs font-bold text-lime">WINNER</span>}
                      <span className="font-display font-bold tabular text-gold">{formatMultiplier(multiplier(m, pools, o.key))}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 text-xs text-muted">{count} bets placed</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function roundNets(round: number, markets: Market[], bets: Bet[], players: Player[]) {
  const settled = new Set(markets.filter((m) => m.round === round && m.status === "settled").map((m) => m.id));
  const net = new Map<string, number>();
  for (const b of bets) if (settled.has(b.market_id)) net.set(b.player_id, (net.get(b.player_id) ?? 0) + (b.payout ?? 0) - b.amount);
  return players
    .map((p) => ({ player: p, net: net.get(p.id) ?? 0 }))
    .filter((x) => x.net !== 0)
    .sort((a, b) => b.net - a.net);
}

function Results({
  game,
  marbles,
  markets,
  bets,
  players,
  order,
  busy,
  onNext,
}: {
  game: Game;
  marbles: MarbleRow[];
  markets: Market[];
  bets: Bet[];
  players: Player[];
  order: number[] | null;
  busy: boolean;
  onNext: () => void;
}) {
  const round = game.round;
  const out = marbles.filter((m) => m.eliminated_round === round).map((m) => m.slot);
  const winnerMarket = markets.find((m) => m.round === round && m.kind === "round_winner");
  const winner = order?.[0] ?? (winnerMarket?.result ? Number(winnerMarket.result[0]) : null);
  const remaining = marbles.filter((m) => m.eliminated_round === null).length;
  const nextIsFinal = remaining - eliminationsFor(game, round + 1) === 1;
  const nets = roundNets(round, markets, bets, players);
  const best = nets.slice(0, 3);
  const worst = nets.filter((n) => n.net < 0).slice(-2).reverse();

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ink/70 p-8 backdrop-blur-sm">
      <div className="pop-in grid w-full max-w-6xl grid-cols-3 gap-6">
        <section className="col-span-1 flex flex-col gap-3 rounded-2xl bg-panel p-5">
          <h2 className="font-display text-3xl font-extrabold uppercase">Race {round} results</h2>
          {winner !== null && (
            <div className="flex items-center gap-3 rounded-xl bg-gold/15 p-3 ring-1 ring-gold">
              <MarbleDot slot={winner} size={40} />
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-gold">Winner</div>
                <div className="font-display text-3xl font-bold">{name(winner)}</div>
              </div>
            </div>
          )}
          {order ? (
            <ol className="grid grid-cols-2 gap-1 text-sm">
              {order.map((slot, i) => (
                <li key={slot} className={`flex items-center gap-2 rounded-md px-2 py-1 ${out.includes(slot) ? "bg-danger/25 line-through decoration-danger" : "bg-panel-2"}`}>
                  <span className="w-5 text-right font-bold text-muted tabular">{i + 1}</span>
                  <MarbleChip slot={slot} className="min-w-0" />
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        <section className="flex flex-col gap-3 rounded-2xl bg-panel p-5">
          <h2 className="font-display text-3xl font-extrabold uppercase text-danger">Knocked out</h2>
          <ul className="flex flex-col gap-2">
            {out.map((slot, i) => (
              <li key={slot} className="pop-in flex items-center gap-3 rounded-xl bg-danger/15 p-3" style={{ animationDelay: `${i * 250}ms` }}>
                <MarbleDot slot={slot} size={32} />
                <span className="font-display text-2xl font-bold">{name(slot)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-auto text-muted">{remaining} marbles remain</div>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl bg-panel p-5">
          <h2 className="font-display text-3xl font-extrabold uppercase text-lime">Big winners</h2>
          {best.filter((n) => n.net > 0).length ? (
            <ul className="flex flex-col gap-2">
              {best
                .filter((n) => n.net > 0)
                .map((n) => (
                  <li key={n.player.id} className="flex items-center justify-between rounded-xl bg-lime/10 px-3 py-2">
                    <span className="font-semibold">{n.player.nickname}</span>
                    <span className="font-display text-2xl font-bold tabular text-lime">+{n.net}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-muted">Nobody cashed in this race. The house thanks you.</p>
          )}
          {worst.length > 0 && (
            <div className="text-sm text-muted">
              Ouch: {worst.map((n) => `${n.player.nickname} (${n.net})`).join(", ")}
            </div>
          )}
          <div className="mt-2 text-xs font-bold uppercase tracking-widest text-muted">Standings</div>
          <Leaderboard players={players} bets={bets} markets={markets} limit={6} />
          <button
            onClick={onNext}
            disabled={busy}
            className="font-display mt-auto rounded-xl bg-lime px-5 py-4 text-2xl font-extrabold uppercase text-ink disabled:opacity-50"
          >
            {busy ? "Building next track…" : nextIsFinal ? "On to the grand final ▶" : `Open betting for race ${round + 1} ▶`}
          </button>
        </section>
      </div>
    </div>
  );
}

function Champion({ markets, bets, players }: { markets: Market[]; bets: Bet[]; players: Player[] }) {
  const outright = markets.find((m) => m.kind === "outright" && m.status === "settled" && m.result?.length);
  const slot = outright?.result ? Number(outright.result[0]) : null;
  const confetti = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i % 12) * 0.25,
        color: ["var(--lime)", "var(--pink)", "var(--gold)", "#4ab3ff"][i % 4],
      })),
    [],
  );
  return (
    <div className="absolute inset-0 overflow-hidden bg-ink/80 backdrop-blur-sm">
      <style>{`@keyframes fall { from { transform: translateY(-10vh) rotate(0) } to { transform: translateY(110vh) rotate(720deg) } }`}</style>
      {confetti.map((c, i) => (
        <span
          key={i}
          className="absolute top-0 h-3 w-2"
          style={{ left: `${c.left}%`, background: c.color, animation: `fall 3.5s linear ${c.delay}s infinite` }}
        />
      ))}
      <div className="relative flex h-full items-center justify-center gap-16 p-10">
        {slot !== null && (
          <div className="pop-in flex flex-col items-center gap-4 text-center">
            <div className="font-display text-3xl font-bold uppercase tracking-[0.3em] text-gold">Champion</div>
            <MarbleDot slot={slot} size={200} />
            <div className="font-display text-8xl font-extrabold uppercase">{name(slot)}</div>
          </div>
        )}
        <div className="w-[420px] rounded-2xl bg-panel p-5">
          <div className="font-display mb-3 text-3xl font-extrabold uppercase text-lime">Final standings</div>
          <Leaderboard players={players} bets={bets} markets={markets} size="lg" limit={10} />
        </div>
      </div>
    </div>
  );
}
