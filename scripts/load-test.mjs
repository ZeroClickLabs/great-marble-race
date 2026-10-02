#!/usr/bin/env node
/**
 * Game-day load test: N simulated phones + a host play one race against the real Supabase project.
 *
 *   node --env-file=.env scripts/load-test.mjs [--players 20] [--race 45]
 *
 * Each simulated phone opens the same realtime subscriptions as the real /play page. The host
 * broadcasts race ticks, opens three live props (each followed by a burst of bets), then settles
 * everything the way the director does. Reports bet latency, errors, realtime throughput and
 * any channel disconnects.
 *
 * Anonymous sign-ins are rate limited per IP (~30/hour), so sessions are cached in
 * .loadtest-sessions.json and reused on later runs.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const PLAYERS = Number(args.players ?? 20);
const RACE_SECONDS = Number(args.race ?? 45);
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!URL || !KEY) throw new Error("Run with --env-file=.env (needs NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY)");

const SESSIONS_FILE = ".loadtest-sessions.json";
const cached = existsSync(SESSIONS_FILE) ? JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) : [];
const sessions = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a);

// ------------------------------------------------------------------ metrics
const received = new Map(); // second -> count (messages delivered to all clients)
const channelProblems = [];
let tearingDown = false;
const rpcTimes = [];
const rpcErrors = [];
const count = () => {
  const sec = Math.floor((Date.now() - t0) / 1000);
  received.set(sec, (received.get(sec) ?? 0) + 1);
};

async function makeClient(i) {
  const c = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: true } });
  const prior = cached[i];
  if (prior) {
    const { error } = await c.auth.setSession(prior);
    if (!error) {
      const { data } = await c.auth.getSession();
      sessions[i] = { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
      return c;
    }
  }
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw new Error(`sign-in ${i}: ${error.message}`);
  sessions[i] = { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
  return c;
}

async function rpc(c, fn, params, label = fn) {
  const start = performance.now();
  const { data, error } = await c.rpc(fn, params);
  const ms = performance.now() - start;
  if (fn === "place_bet") rpcTimes.push(ms);
  if (error) {
    rpcErrors.push(`${label}: ${error.message}`);
    return null;
  }
  return data;
}

/** Same subscriptions as lib/game/useGame.ts, plus useRaceFeed for phones (the host only sends race ticks). */
function subscribe(c, name, gameId, { raceFeed = true } = {}) {
  const filter = `game_id=eq.${gameId}`;
  const watch = (status, err) => {
    if (status !== "SUBSCRIBED" && !tearingDown) channelProblems.push(`${name} ${status}${err ? `: ${err.message}` : ""} @${((Date.now() - t0) / 1000).toFixed(1)}s`);
  };
  const db = c.channel(`db:${gameId}:${name}`);
  for (const [table, f, event] of [
    ["games", `id=eq.${gameId}`, "*"],
    ["players", filter, "*"],
    ["marbles", filter, "*"],
    ["markets", filter, "*"],
    ["bets", filter, "INSERT"],
  ])
    db.on("postgres_changes", { event, schema: "public", table, filter: f }, (p) => {
      count();
      // Mirror useGame: refetch payouts once when a market settles.
      if (table === "markets" && (p.new.status === "settled" || p.new.status === "void")) {
        clearTimeout(c.__betsTimer);
        c.__betsTimer = setTimeout(() => c.from("bets").select("id").eq("game_id", gameId), 600);
      }
    });
  db.subscribe(watch);
  if (!raceFeed) return [db];
  const race = c.channel(`race:${gameId}`).on("broadcast", { event: "tick" }, count).on("broadcast", { event: "caption" }, count);
  race.subscribe(watch);
  return [db, race];
}

const opts = (n) => Array.from({ length: n }, (_, slot) => ({ key: String(slot), label: `M${slot}`, slot }));
const YES_NO = [
  { key: "yes", label: "Yes" },
  { key: "no", label: "No" },
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------------ run
log(`Signing in host + ${PLAYERS} players…`);
const host = await makeClient(0);
const game = await rpc(host, "create_game", { p_config: { eliminations: [6, 4, 3, 2], startingBalance: 1000 } });
if (!game) throw new Error(rpcErrors.join("\n"));
await rpc(host, "set_game_state", { p_game: game.id, p_status: "lobby", p_round: 1, p_race_seed: 1 });
const open = (kind, question, options, extra = {}) =>
  rpc(host, "open_market", {
    p_game: game.id,
    p_round: 1,
    p_kind: kind,
    p_question: question,
    p_options: options,
    p_winners_expected: extra.winners ?? 1,
    p_window_seconds: extra.window ?? null,
  });
const preRace = (await Promise.all([open("outright", "Champion?", opts(16)), open("round_winner", "Winner?", opts(16)), open("round_elim", "Out?", opts(16), { winners: 6 })])).filter(Boolean);
log(`Game ${game.code} created`);

const players = [];
for (let i = 1; i <= PLAYERS; i++) {
  const c = await makeClient(i);
  await rpc(c, "join_game", { p_code: game.code, p_nickname: `load-${String(i).padStart(2, "0")}` });
  players.push(c);
}
writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
const channels = [subscribe(host, "host", game.id, { raceFeed: false }), ...players.map((c, i) => subscribe(c, `p${i + 1}`, game.id))];
await sleep(3000); // let subscriptions settle
log(`${PLAYERS} players joined and subscribed`);

// Like lib/game/api.ts: use the retry-safe 4-arg place_bet, falling back if the migration isn't applied.
let legacyPlaceBet = null;
async function bet(c, market, option, amount) {
  const params = { p_market: market.id, p_option: option, p_amount: amount };
  if (legacyPlaceBet !== true) {
    const start = performance.now();
    const { error } = await c.rpc("place_bet", { ...params, p_client_id: randomUUID() });
    if (!error) {
      legacyPlaceBet = false;
      rpcTimes.push(performance.now() - start);
      return;
    }
    if (error.code !== "PGRST202") return void rpcErrors.push(`place_bet: ${error.message}`);
    legacyPlaceBet = true;
  }
  return rpc(c, "place_bet", params, "place_bet (legacy)");
}

// Pre-race: each player places 2-3 bets over ~6 seconds.
log("Pre-race betting…");
await Promise.all(
  players.map(async (c) => {
    for (let k = 0; k < 2 + Math.floor(Math.random() * 2); k++) {
      await sleep(Math.random() * 3000);
      const m = pick(preRace);
      await bet(c, m, pick(m.options).key, 10 + Math.floor(Math.random() * 90));
    }
  }),
);

log("Race starts: lock, broadcast ticks, three live props");
await rpc(host, "lock_markets", { p_ids: preRace.map((m) => m.id) });
await rpc(host, "set_game_state", { p_game: game.id, p_status: "racing", p_round: 1, p_race_seed: 1 });
const broadcaster = host.channel(`race:${game.id}`, { config: { broadcast: { self: false } } });
await new Promise((res, rej) => {
  setTimeout(() => rej(new Error("broadcast channel never subscribed")), 15000);
  broadcaster.subscribe((s) => s === "SUBSCRIBED" && res());
});
const standings = Array.from({ length: 16 }, (_, i) => i);
let ticking = true;
(async () => {
  while (ticking) {
    await broadcaster.send({
      type: "broadcast",
      event: "tick",
      payload: { round: 1, time: 0, standings, finished: [], progress: Object.fromEntries(standings.map((s) => [s, Math.random()])), eliminate: 6 },
    });
    await sleep(450);
  }
})();

const raceT0 = Date.now();
const props = [];
for (const [at, question, options] of [
  [1, "Who leads at Checkpoint 2?", [...opts(5), { key: "other", label: "Anyone else" }]],
  [RACE_SECONDS * 0.3, "Will M3 win this race?", YES_NO],
  [RACE_SECONDS * 0.7, "Will M9 escape elimination?", YES_NO],
]) {
  const wait = at * 1000 - (Date.now() - raceT0);
  if (wait > 0) await sleep(wait);
  const m = await open("prop", question, options, { window: 15 });
  if (!m) continue;
  props.push(m);
  log(`Prop opened: ${question} — burst of bets`);
  // ~80% of players react within 1-4 s.
  players.forEach((c) => {
    if (Math.random() < 0.8) setTimeout(() => bet(c, m, pick(m.options).key, 10 + Math.floor(Math.random() * 60)), 1000 + Math.random() * 3000);
  });
}
await sleep(Math.max(0, RACE_SECONDS * 1000 - (Date.now() - raceT0)));
ticking = false;
log("Race over: settling markets one at a time (as the director does)");
const winner = String(Math.floor(Math.random() * 16));
const out = ["10", "11", "12", "13", "14", "15"];
const toSettle = [
  [preRace.find((m) => m.kind === "round_winner"), [winner]],
  [preRace.find((m) => m.kind === "round_elim"), out],
  ...props.map((m) => [m, [pick(m.options).key]]),
].filter(([m]) => m);
for (const [i, [m, winners]] of toSettle.entries()) {
  if (i) await sleep(250);
  await rpc(host, "settle_market", { p_market: m.id, p_winners: winners }, "settle_market");
}
await rpc(host, "eliminate", { p_game: game.id, p_round: 1, p_slots: out.map(Number) });
await rpc(host, "set_game_state", { p_game: game.id, p_status: "results", p_round: 1, p_race_seed: 1 });
await sleep(5000);

// ------------------------------------------------------------------ report
tearingDown = true;
for (const pair of channels) for (const ch of pair) await ch.unsubscribe();
await host.removeChannel(broadcaster);
const sorted = [...rpcTimes].sort((a, b) => a - b);
const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(0) : "-");
const perSec = [...received.values()];
const total = perSec.reduce((a, b) => a + b, 0);
console.log("\n================ Load test report ================");
console.log(`Game ${game.code}: host + ${PLAYERS} players, ${RACE_SECONDS}s race`);
if (legacyPlaceBet) console.log("NOTE: bet_retries_and_grace migration NOT applied — used the legacy place_bet");
console.log(`Bets placed: ${rpcTimes.length}   latency p50 ${pct(0.5)} ms · p95 ${pct(0.95)} ms · max ${pct(1)} ms`);
console.log(`RPC errors: ${rpcErrors.length}${rpcErrors.length ? "\n  " + [...new Set(rpcErrors)].slice(0, 8).join("\n  ") : ""}`);
console.log(`Realtime messages delivered: ${total}   peak ${Math.max(0, ...perSec)}/s   (Pro no-cap limit 2,500/s, Pro 500/s, Free 100/s)`);
const busiest = [...received.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log(`Busiest seconds: ${busiest.map(([sec, n]) => `${sec}s→${n}`).join(", ")}`);
console.log(`Channel problems: ${channelProblems.length}${channelProblems.length ? "\n  " + channelProblems.slice(0, 10).join("\n  ") : ""}`);
console.log(channelProblems.length || rpcErrors.length ? "RESULT: issues found" : "RESULT: clean run");
process.exit(0);
