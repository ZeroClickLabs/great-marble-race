"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { RaceEvent } from "@/lib/race/engine";
import type { RaceSnapshot } from "@/lib/race/runner";
import { audioEngine, measureLevel, type AudioEngine } from "./engine";
import type { Intensity } from "./music";

/**
 * Host-side audio: creates the engine, unlocks it on the first click anywhere (browsers block
 * sound until a gesture), and keeps the music on the right theme and intensity.
 */
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __measureLevel: typeof measureLevel }).__measureLevel = measureLevel;
}

export function useRaceAudio(theme: string | null, intensity: Intensity) {
  // Client-only: the server render never touches audio.
  const [engine] = useState<AudioEngine | null>(() => (typeof window === "undefined" ? null : audioEngine()));
  const [prefs, setPrefs] = useState(() => ({ muted: engine?.prefs.muted ?? false, volume: engine?.prefs.volume ?? 0.8 }));
  const unlocked = useSyncExternalStore(
    (notify) => {
      engine?.ctx.addEventListener("statechange", notify);
      return () => engine?.ctx.removeEventListener("statechange", notify);
    },
    () => engine?.unlocked ?? false,
    () => false,
  );

  useEffect(() => {
    if (!engine) return;
    const unlock = () => engine.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      engine.stopMusic();
    };
  }, [engine]);

  useEffect(() => {
    if (engine && theme) engine.playTheme(theme, intensity);
  }, [engine, theme, intensity]);

  return {
    engine,
    unlocked,
    prefs,
    setMuted: (muted: boolean) => {
      engine?.setMuted(muted);
      setPrefs((p) => ({ ...p, muted }));
    },
    setVolume: (volume: number) => {
      engine?.setVolume(volume);
      if (engine) setPrefs({ ...engine.prefs });
    },
  };
}

/** Sound effects for race events. */
export function playRaceEvent(engine: AudioEngine | null, e: RaceEvent, eliminations: number) {
  if (!engine) return;
  switch (e.type) {
    case "lead_change":
      return engine.leadChange();
    case "checkpoint":
      return engine.checkpoint();
    case "boost":
      return engine.boost();
    case "finished":
      return engine.finished(e.place);
    case "race_over":
      if (eliminations > 0) engine.elimination();
      return;
  }
}

/** Ambience that follows the race: rolling rumble, crowd near the finish, slow-mo muffle. */
export function updateRaceAmbience(engine: AudioEngine | null, s: RaceSnapshot) {
  if (!engine) return;
  engine.setRolling(s.phase === "running" ? s.pace : 0);
  const lead = s.progress[s.standings[0]] ?? 0;
  engine.setCrowd(s.phase === "running" ? Math.max(0.15, (lead - 0.6) * 2.5) : s.phase === "done" ? 0.3 : 0.1);
  engine.setSlowMo(s.slowMo);
}

/** Music intensity from game state: calm while betting, full band while racing, finale near the line. */
export function raceIntensity(racing: boolean, s: RaceSnapshot | null, finalRace: boolean): Intensity {
  if (!racing || !s || s.phase === "grid") return 0;
  const lead = s.progress[s.standings[0]] ?? 0;
  return finalRace || lead > 0.7 ? 2 : 1;
}
