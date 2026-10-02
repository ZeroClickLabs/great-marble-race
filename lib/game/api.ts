"use client";

import { supabase } from "@/lib/supabase/client";
import { MARBLES, marbleBySlot } from "@/lib/race/marbles";
import type { Bet, Game, GameConfig, GameStatus, Market, MarketKind, MarketOption, Player } from "./types";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/** Remembered between games so people don't retype their name. */
export const NICKNAME_KEY = "gmr:nickname";

export const marbleOptions = (slots: number[]): MarketOption[] =>
  slots.map((slot) => ({ key: String(slot), label: marbleBySlot(slot).name, slot }));

export const YES_NO: MarketOption[] = [
  { key: "yes", label: "Yes" },
  { key: "no", label: "No" },
];

export function openMarket(
  game: Game,
  round: number,
  kind: MarketKind,
  question: string,
  options: MarketOption[],
  opts: { winnersExpected?: number; windowSeconds?: number } = {},
) {
  return rpc<Market>("open_market", {
    p_game: game.id,
    p_round: round,
    p_kind: kind,
    p_question: question,
    p_options: options,
    p_winners_expected: opts.winnersExpected ?? 1,
    p_window_seconds: opts.windowSeconds ?? null,
  });
}

/** Pre-race markets for a round. */
export async function openRoundMarkets(game: Game, round: number, activeSlots: number[]) {
  const elim = game.config.eliminations[round - 1];
  const options = marbleOptions(activeSlots);
  const final = activeSlots.length - elim === 1;
  const jobs: Promise<Market>[] = [];
  if (round === 1) jobs.push(openMarket(game, round, "outright", "Who will be crowned champion?", options));
  else if (!final) jobs.push(openMarket(game, round, "outright", "Late money: who wins it all?", options));
  jobs.push(openMarket(game, round, "round_winner", final ? "Who wins the grand final?" : `Who wins Race ${round}?`, options));
  if (!final) {
    jobs.push(
      openMarket(game, round, "round_elim", elim === 1 ? `Who gets knocked out in Race ${round}?` : `Pick a marble that gets knocked out (${elim} go)`, options, {
        winnersExpected: elim,
      }),
    );
  }
  return Promise.all(jobs);
}

export async function createGame(eliminations: number[], raceSeed: number) {
  const config: GameConfig = { eliminations, startingBalance: 1000 };
  const game = await rpc<Game>("create_game", { p_config: config });
  await rpc<Game>("set_game_state", { p_game: game.id, p_status: "lobby", p_round: 1, p_race_seed: raceSeed });
  await openRoundMarkets(game, 1, MARBLES.map((m) => m.slot));
  return game;
}

export const joinGame = (code: string, nickname: string) => rpc<Player>("join_game", { p_code: code, p_nickname: nickname });
/** Network-level failure (request never got a response), as opposed to the server saying no. */
export function isNetworkError(e: unknown) {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return /^(TypeError|FetchError)\b|Load failed|Failed to fetch|NetworkError|network connection was lost/i.test(msg);
}

function newBetId() {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  // Older Safari (< 15.4): RFC 4122 v4 from getRandomValues.
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const RETRY_DELAYS_MS = [150, 400, 900];

/**
 * Place a bet, retrying dropped requests. Phones often lose the first request after switching
 * back from another app (Zoom); the bet id makes retries safe — the server returns the original
 * bet instead of placing it twice.
 */
export async function placeBet(marketId: string, option: string, amount: number) {
  const id = newBetId();
  let legacy = false;
  for (let attempt = 0; ; attempt++) {
    try {
      const args: Record<string, unknown> = { p_market: marketId, p_option: option, p_amount: amount };
      if (!legacy) args.p_client_id = id;
      return await rpc<Bet>("place_bet", args);
    } catch (e) {
      // Database not migrated yet: fall back to the original three-argument function.
      if (!legacy && (e as { code?: string }).code === "PGRST202") {
        legacy = true;
        attempt--;
        continue;
      }
      if (!isNetworkError(e) || attempt >= RETRY_DELAYS_MS.length) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}
export const lockMarkets = (ids: string[]) => (ids.length ? rpc<void>("lock_markets", { p_ids: ids }) : Promise.resolve());
export const settleMarket = (id: string, winners: string[]) => rpc<Market>("settle_market", { p_market: id, p_winners: winners });
export const voidMarket = (id: string) => rpc<void>("void_market", { p_market: id });
export const setGameState = (game: Game, status: GameStatus, round: number, raceSeed: number | null) =>
  rpc<Game>("set_game_state", { p_game: game.id, p_status: status, p_round: round, p_race_seed: raceSeed });
export const eliminate = (game: Game, round: number, slots: number[]) =>
  rpc<void>("eliminate", { p_game: game.id, p_round: round, p_slots: slots });
export const bailout = (game: Game, floor: number) => rpc<void>("bailout", { p_game: game.id, p_floor: floor });

export async function fetchForms(gameId: string): Promise<number[]> {
  const { data } = await supabase().from("game_secrets").select("forms").eq("game_id", gameId).maybeSingle();
  return (data?.forms as number[]) ?? [];
}
