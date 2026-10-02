"use client";

import type { RaceEvent } from "@/lib/race/engine";
import { marbleBySlot } from "@/lib/race/marbles";
import { randomSeed } from "@/lib/race/rng";
import {
  bailout,
  eliminate,
  lockMarkets,
  marbleOptions,
  openMarket,
  openRoundMarkets,
  setGameState,
  settleMarket,
  YES_NO,
} from "./api";
import type { Game, Market, MarketOption } from "./types";

const name = (slot: number) => marbleBySlot(slot).name;

/** Live prop windows, in seconds. Generous: players are switching from Zoom to their phone, over a lagging screen share. */
const PROP_WINDOW = { cpLeader: 20, leaderWins: 15, survive: 12 };
const BAILOUT_FLOOR = 100;

export const eliminationsFor = (game: Game, round: number) => game.config.eliminations[round - 1] ?? 1;

/**
 * Turns race events into market operations for one race: locks pre-race betting,
 * opens live props as the race unfolds, then settles everything at the finish.
 * All RPCs run through one queue so a prop is always open before it is settled.
 */
export class RaceDirector {
  private queue: Promise<unknown> = Promise.resolve();
  private cpLeader?: Market;
  private leaderWins?: { market: Market; slot: number };
  private survive?: { market: Market; slot: number };
  private finished = false;
  private cpSettled = false;
  private openingPropRequested = false;

  constructor(
    private game: Game,
    private round: number,
    private active: number[],
    /** Latest markets from realtime state, used to reuse props after a host reload. */
    private markets: () => Market[],
    private onError: (e: unknown) => void,
  ) {}

  get eliminate() {
    return eliminationsFor(this.game, this.round);
  }

  private get isFinal() {
    return this.active.length - this.eliminate === 1;
  }

  private enqueue(fn: () => Promise<unknown>) {
    this.queue = this.queue.then(fn).catch(this.onError);
    return this.queue;
  }

  /** Reuse an existing prop with the same question (host reloaded mid-race), otherwise open it. */
  private async prop(question: string, options: MarketOption[], windowSeconds: number) {
    const existing = this.markets().find((m) => m.kind === "prop" && m.round === this.round && m.question === question);
    return existing ?? openMarket(this.game, this.round, "prop", question, options, { windowSeconds });
  }

  /** Lock pre-race markets and flip the game to racing. */
  beginRace() {
    return this.enqueue(async () => {
      const open = this.markets().filter((m) => m.status === "open").map((m) => m.id);
      await lockMarkets(open);
      await setGameState(this.game, "racing", this.round, this.game.race_seed);
    });
  }

  /** First live prop, opened as the gate drops (it locks at Checkpoint 1). Safe to call repeatedly. */
  openOpeningProp(standings: number[]) {
    if (this.openingPropRequested) return;
    this.openingPropRequested = true;
    const top = standings.slice(0, 5);
    const options = marbleOptions(top);
    if (standings.length > top.length) options.push({ key: "other", label: "Anyone else" });
    this.enqueue(async () => {
      this.cpLeader = await this.prop("Who leads at Checkpoint 2?", options, PROP_WINDOW.cpLeader);
    });
  }

  handle(e: RaceEvent) {
    switch (e.type) {
      case "checkpoint": {
        if (e.index === 0) {
          const slot = e.leader;
          this.enqueue(async () => {
            if (this.cpLeader) await lockMarkets([this.cpLeader.id]);
            const market = await this.prop(`Will ${name(slot)} win this race?`, YES_NO, PROP_WINDOW.leaderWins);
            this.leaderWins = { market, slot };
          });
        } else if (e.index === 1) {
          this.enqueue(async () => {
            await this.settleCpLeader(e.leader);
          });
        } else if (e.index === 2 && !this.isFinal && this.eliminate > 0) {
          // The marble currently first in line for elimination.
          const slot = e.standings[e.standings.length - this.eliminate];
          this.enqueue(async () => {
            const market = await this.prop(`Will ${name(slot)} escape elimination?`, YES_NO, PROP_WINDOW.survive);
            this.survive = { market, slot };
          });
        }
        break;
      }
      case "race_over":
        this.finishRace(e.order);
        break;
    }
  }

  private async settleCpLeader(leader: number) {
    const m = this.cpLeader;
    if (!m || this.cpSettled) return;
    this.cpSettled = true;
    const key = m.options.some((o) => o.key === String(leader)) ? String(leader) : "other";
    await settleMarket(m.id, [key]);
  }

  private finishRace(order: number[]) {
    if (this.finished) return;
    this.finished = true;
    const out = order.slice(order.length - this.eliminate);
    const winner = order[0];
    this.enqueue(async () => {
      const mine = this.markets().filter((m) => m.round === this.round);
      const props = mine.filter((m) => m.kind === "prop" && m.status !== "settled" && m.status !== "void");
      await lockMarkets(props.map((m) => m.id));

      // Settle one market at a time, briefly spaced: each settlement fans out a realtime update
      // per bet and per balance to every screen, and doing them all at once spikes past the
      // Supabase messages-per-second limit with a full room.
      const settle: (() => Promise<unknown>)[] = [];
      for (const m of mine) {
        if (m.status === "settled" || m.status === "void") continue;
        if (m.kind === "round_winner") settle.push(() => settleMarket(m.id, [String(winner)]));
        if (m.kind === "round_elim") settle.push(() => settleMarket(m.id, out.map(String)));
      }
      const leaderWins = this.leaderWins;
      const survive = this.survive;
      if (leaderWins) settle.push(() => settleMarket(leaderWins.market.id, [order[0] === leaderWins.slot ? "yes" : "no"]));
      if (survive) settle.push(() => settleMarket(survive.market.id, [out.includes(survive.slot) ? "no" : "yes"]));
      // Race called before Checkpoint 2: settle on whoever leads at the end.
      settle.push(() => this.settleCpLeader(winner));
      await settleSpaced(settle);

      await eliminate(this.game, this.round, out);
      if (this.isFinal) {
        const outrights = this.markets().filter((m) => m.kind === "outright" && m.status !== "settled");
        await settleSpaced(outrights.map((m) => () => settleMarket(m.id, [String(winner)])));
        await setGameState(this.game, "finished", this.round, this.game.race_seed);
      } else {
        await setGameState(this.game, "results", this.round, this.game.race_seed);
      }
    });
  }
}

const SETTLE_GAP_MS = 250;

async function settleSpaced(jobs: (() => Promise<unknown>)[]) {
  for (const [i, job] of jobs.entries()) {
    if (i) await new Promise((r) => setTimeout(r, SETTLE_GAP_MS));
    await job();
  }
}

/** Move from the results screen to betting on the next race. */
export async function advanceRound(game: Game, activeSlots: number[]) {
  const round = game.round + 1;
  await bailout(game, BAILOUT_FLOOR);
  const next = await setGameState(game, "betting", round, randomSeed());
  await openRoundMarkets(next, round, activeSlots);
}

export const BAILOUT = BAILOUT_FLOOR;
