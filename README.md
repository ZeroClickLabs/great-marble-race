# The Great Marble Race

A live marble-racing betting game for team video calls. The host screen-shares a 3D physics race; everyone else bets Marble Bucks from their phone. The lowest finishers are knocked out each race until one marble is crowned champion.

## How a game works

1. **Host** opens the site, picks a length (Quick 4 races · Standard 6 · Marathon 8) and clicks **Create game**, then shares that browser window on Zoom.
2. **Players** scan the QR code or go to the site and enter the 4-letter code. Everyone starts with 1,000 Marble Bucks.
3. **Before each race**, players bet on:
   - **Race winner**
   - **Elimination** (pick a marble that gets knocked out)
   - **Champion**: opens in the lobby; "late money" reopens between races at shorter odds.
4. **During the race**, live props pop up on phones for a few seconds each:
   - "Who leads at Checkpoint 2?"
   - "Will {leader} win this race?"
   - "Will {marble on the bubble} escape elimination?"
5. **After each race**, bets settle automatically, eliminations are revealed, and the host clicks to open the next race. Anyone who's gone broke is topped back up to 100.

Odds are **pari-mutuel**: each market is one pot, and everyone who bet on a winning option splits it in proportion to their stake, so odds move as money comes in. A small virtual seed on every option keeps early odds sane.

## Setup

1. Create a free project at [supabase.com](https://supabase.com/dashboard).
2. **Authentication → Sign In / Providers → Allow anonymous sign-ins**: turn it on.
3. Copy `.env.local.example` to `.env.local` (or `.env`) and fill in the Project URL and **publishable** key.
4. Apply the schema: run `supabase/migrations/*_init.sql` in the dashboard SQL Editor, or `supabase link --project-ref <ref> && supabase db push`.
5. `npm install && npm run dev`, then open http://localhost:3000.

Tip for testing alone: each `*.localhost` subdomain gets its own anonymous player, e.g. host on `localhost:3000` and players on `p1.localhost:3000`, `p2.localhost:3000`.

## Deploy

Push to GitHub and import it into [Vercel](https://vercel.com/new), adding the two `NEXT_PUBLIC_SUPABASE_*` env vars. The QR code uses whatever URL the host screen is served from.

## Code map

| Path | What |
| --- | --- |
| `lib/race/track.ts` | Seeded procedural track: banked S-bends, helixes, spinners, pegs, boost pads |
| `lib/race/engine.ts` | Rapier physics race: progress, standings, checkpoint/lead/finish events. Deterministic per seed |
| `lib/race/renderer.ts`, `runner.ts` | three.js view, camera director, slow-mo, animation loop |
| `lib/game/director.ts` | Host-side race control: locks betting, opens/settles live props, eliminates, advances rounds |
| `lib/game/odds.ts` | Pari-mutuel odds (mirrors `private.settle_market` in SQL) |
| `supabase/migrations/` | Schema, RLS and RPCs. Clients only read tables; all writes go through host/player-checked functions |
| `components/host/HostGame.tsx` | The screen-shared host view |
| `components/play/PlayGame.tsx` | The phone view |
| `/sandbox` | Race-only page for tuning tracks and cameras without a backend |

`npm test` runs the odds and race-engine tests (headless physics).
