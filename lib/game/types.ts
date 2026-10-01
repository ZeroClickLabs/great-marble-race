export type GameStatus = "lobby" | "betting" | "racing" | "results" | "finished";
export type MarketKind = "outright" | "round_winner" | "round_elim" | "prop";
export type MarketStatus = "open" | "locked" | "settled" | "void";

export interface GameConfig {
  /** Marbles knocked out in each race, e.g. [4,4,3,2,1,1] takes 16 marbles down to 1. */
  eliminations: number[];
  startingBalance: number;
}

export interface Game {
  id: string;
  code: string;
  host_id: string;
  status: GameStatus;
  round: number;
  config: GameConfig;
  race_seed: number | null;
  created_at: string;
}

export interface Player {
  id: string;
  game_id: string;
  user_id: string;
  nickname: string;
  balance: number;
  created_at: string;
}

export interface MarbleRow {
  game_id: string;
  slot: number;
  eliminated_round: number | null;
}

export interface MarketOption {
  key: string;
  label: string;
  slot?: number;
}

export interface Market {
  id: string;
  game_id: string;
  round: number;
  kind: MarketKind;
  question: string;
  options: MarketOption[];
  winners_expected: number;
  seed_pool: number;
  status: MarketStatus;
  closes_at: string | null;
  result: string[] | null;
  created_at: string;
}

export interface Bet {
  id: string;
  market_id: string;
  game_id: string;
  player_id: string;
  option: string;
  amount: number;
  payout: number | null;
  created_at: string;
}

export const GAME_PRESETS = {
  quick: { label: "Quick", blurb: "4 races · ~15 min", eliminations: [6, 4, 3, 2] },
  standard: { label: "Standard", blurb: "6 races · ~25 min", eliminations: [4, 4, 3, 2, 1, 1] },
  marathon: { label: "Marathon", blurb: "8 races · ~35 min", eliminations: [3, 3, 2, 2, 2, 1, 1, 1] },
} as const;

export type PresetKey = keyof typeof GAME_PRESETS;

/** Live race positions the host broadcasts to phones. */
export interface RaceTick {
  round: number;
  time: number;
  standings: number[];
  finished: number[];
  progress: Record<number, number>;
  eliminate: number;
}

export interface RaceCaption {
  id: number;
  text: string;
  tone?: "lead" | "finish" | "prop" | "danger";
  /** Local receipt time (ms); captions fade out after CAPTION_MS. */
  at: number;
}

export const CAPTION_MS = 6000;
