"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ensureSession, supabase } from "@/lib/supabase/client";
import type { Bet, Game, MarbleRow, Market, Player } from "./types";

export interface GameState {
  userId: string | null;
  game: Game | null;
  players: Player[];
  marbles: MarbleRow[];
  markets: Market[];
  bets: Bet[];
  /** "loading" → "ready", or "not_member" when this user hasn't joined (or the code is wrong). */
  phase: "loading" | "ready" | "not_member" | "error";
  error?: string;
  /** Estimated server clock minus local clock (ms), so countdowns match the server's betting cutoff. */
  clockOffset: number;
  clockOffsetSampled?: boolean;
}

const EMPTY: GameState = { userId: null, game: null, players: [], marbles: [], markets: [], bets: [], phase: "loading", clockOffset: 0 };
const MAX_SKEW_MS = 120_000;

function upsert<T>(rows: T[], row: T, key: (r: T) => string) {
  const k = key(row);
  const i = rows.findIndex((r) => key(r) === k);
  if (i === -1) return [...rows, row];
  const next = [...rows];
  next[i] = row;
  return next;
}

/** Loads a game by join code and keeps it live via Supabase Realtime. */
export function useGame(code: string) {
  const [state, setState] = useState<GameState>(EMPTY);
  const [reloadKey, setReloadKey] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    const sb = supabase();

    async function loadAll(gameId: string) {
      const [players, marbles, markets, bets, game] = await Promise.all([
        sb.from("players").select("*").eq("game_id", gameId),
        sb.from("marbles").select("*").eq("game_id", gameId),
        sb.from("markets").select("*").eq("game_id", gameId).order("created_at"),
        sb.from("bets").select("*").eq("game_id", gameId),
        sb.from("games").select("*").eq("id", gameId).single(),
      ]);
      if (cancelled) return;
      setState((s) => ({
        ...s,
        game: (game.data as Game) ?? s.game,
        players: (players.data as Player[]) ?? [],
        marbles: (marbles.data as MarbleRow[]) ?? [],
        markets: (markets.data as Market[]) ?? [],
        bets: (bets.data as Bet[]) ?? [],
        phase: "ready",
      }));
    }

    (async () => {
      try {
        const userId = await ensureSession();
        const { data: game } = await sb.from("games").select("*").eq("code", code.toUpperCase()).maybeSingle();
        if (cancelled) return;
        if (!game) {
          setState({ ...EMPTY, userId, phase: "not_member" });
          return;
        }
        setState((s) => ({ ...s, userId, game: game as Game }));
        const filter = `game_id=eq.${game.id}`;
        const channel = sb
          .channel(`db:${game.id}:${Math.random().toString(36).slice(2)}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${game.id}` }, (p) =>
            setState((s) => ({ ...s, game: p.new as Game })),
          )
          .on("postgres_changes", { event: "*", schema: "public", table: "players", filter }, (p) =>
            setState((s) => ({ ...s, players: upsert(s.players, p.new as Player, (r) => r.id) })),
          )
          .on("postgres_changes", { event: "*", schema: "public", table: "marbles", filter }, (p) =>
            setState((s) => ({ ...s, marbles: upsert(s.marbles, p.new as MarbleRow, (r) => String(r.slot)) })),
          )
          .on("postgres_changes", { event: "*", schema: "public", table: "markets", filter }, (p) => {
            const market = p.new as Market;
            // A brand-new row's created_at is (server now − delivery latency); the largest sample is the best estimate.
            const sample = p.eventType === "INSERT" ? Date.parse(market.created_at) - Date.now() : null;
            setState((s) => ({
              ...s,
              markets: upsert(s.markets, market, (r) => r.id),
              clockOffset:
                sample !== null && Math.abs(sample) < MAX_SKEW_MS && (s.clockOffsetSampled ? sample > s.clockOffset : true)
                  ? sample
                  : s.clockOffset,
              clockOffsetSampled: s.clockOffsetSampled || sample !== null,
            }));
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "bets", filter }, (p) =>
            setState((s) => ({ ...s, bets: upsert(s.bets, p.new as Bet, (r) => r.id) })),
          )
          .subscribe((status) => {
            // (Re)load after every (re)subscribe so nothing missed while disconnected is lost.
            if (status === "SUBSCRIBED") loadAll(game.id);
          });
        channelRef.current = channel;
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, phase: "error", error: String(e) }));
      }
    })();

    return () => {
      cancelled = true;
      if (channelRef.current) sb.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [code, reloadKey]);

  return { ...state, reload };
}

/** Broadcast channel for high-frequency race data (positions, captions) from host to phones. */
export function raceChannelName(gameId: string) {
  return `race:${gameId}`;
}
