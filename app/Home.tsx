"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MarbleDot } from "@/components/MarbleChip";
import { createGame, joinGame } from "@/lib/game/api";
import { useStoredNickname } from "@/lib/game/useStoredNickname";
import { GAME_PRESETS, type PresetKey } from "@/lib/game/types";
import { MARBLES } from "@/lib/race/marbles";
import { randomSeed } from "@/lib/race/rng";
import { ensureSession, errorMessage } from "@/lib/supabase/client";

export default function Home() {
  const router = useRouter();
  const [preset, setPreset] = useState<PresetKey>("standard");
  const [code, setCode] = useState("");
  const [nickname, setNickname, rememberNickname] = useStoredNickname();
  const [busy, setBusy] = useState<"host" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function host() {
    setBusy("host");
    setError(null);
    try {
      await ensureSession();
      const game = await createGame([...GAME_PRESETS[preset].eliminations], randomSeed());
      router.push(`/host/${game.code}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy("join");
    setError(null);
    try {
      await ensureSession();
      await joinGame(code, nickname);
      rememberNickname(nickname);
      router.push(`/play/${code.trim().toUpperCase()}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-10 sm:py-16">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          {MARBLES.map((m, i) => (
            <span key={m.slot} className="pop-in" style={{ animationDelay: `${i * 40}ms` }}>
              <MarbleDot slot={m.slot} size={22} />
            </span>
          ))}
        </div>
        <h1 className="font-display text-6xl font-extrabold uppercase leading-[0.9] sm:text-8xl">
          The Great
          <br />
          <span className="text-lime">Marble Race</span>
        </h1>
        <p className="max-w-xl text-lg text-muted">
          Sixteen marbles race and one is crowned champion. Bet Marble Bucks before each race, then jump on live props while they roll.
          Lowest finishers get knocked out every round.
        </p>
      </header>

      {error && <p className="rounded-lg border border-danger/50 bg-danger/10 px-4 py-3 text-danger">{error}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <form onSubmit={join} className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-6">
          <h2 className="font-display text-3xl font-bold uppercase">Join a race</h2>
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Game code
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="ABCD"
              autoCapitalize="characters"
              className="font-display rounded-lg border border-line bg-ink px-4 py-3 text-3xl font-bold tracking-[0.3em] text-text uppercase outline-none focus:border-lime"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Your name
            <input
              required
              maxLength={24}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Ada"
              className="rounded-lg border border-line bg-ink px-4 py-3 text-lg text-text outline-none focus:border-lime"
            />
          </label>
          <button
            disabled={busy !== null}
            className="font-display mt-auto rounded-xl bg-lime px-5 py-3 text-2xl font-bold uppercase text-ink transition hover:brightness-110 disabled:opacity-60"
          >
            {busy === "join" ? "Joining…" : "Join"}
          </button>
        </form>

        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-6">
          <h2 className="font-display text-3xl font-bold uppercase">Host a race</h2>
          <p className="text-sm text-muted">Share this screen on Zoom. Everyone else joins on their phone or laptop.</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(GAME_PRESETS) as PresetKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPreset(key)}
                className={`rounded-xl border px-3 py-3 text-left transition ${
                  preset === key ? "border-lime bg-lime/10" : "border-line bg-ink hover:border-muted"
                }`}
              >
                <div className="font-display text-xl font-bold uppercase">{GAME_PRESETS[key].label}</div>
                <div className="text-xs text-muted">{GAME_PRESETS[key].blurb}</div>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={host}
            disabled={busy !== null}
            className="font-display mt-auto rounded-xl border-2 border-lime px-5 py-3 text-2xl font-bold uppercase text-lime transition hover:bg-lime hover:text-ink disabled:opacity-60"
          >
            {busy === "host" ? "Building the track…" : "Create game"}
          </button>
        </div>
      </div>
    </main>
  );
}
