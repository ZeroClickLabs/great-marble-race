"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { initPhysics, type Entrant, type RaceEvent } from "@/lib/race/engine";
import { RaceRunner, type RaceSnapshot } from "@/lib/race/runner";
import { brandFamily } from "@/lib/race/scene/textures";
import { themeByKey } from "@/lib/race/themes";
import { generateTrack, type Track } from "@/lib/race/track";

export interface RaceStageHandle {
  start(): void;
}

interface Props {
  seed: number;
  /** Theme key from lib/race/themes. */
  theme: string;
  entrants: Entrant[];
  eliminate: number;
  onReady?: (track: Track) => void;
  onEvent?: (e: RaceEvent) => void;
  onTick?: (s: RaceSnapshot) => void;
  ref?: Ref<RaceStageHandle>;
}

/** Full-bleed 3D race. Mount it once per race; change `seed` to build a new track. */
export default function RaceStage({ seed, theme, entrants, eliminate, onReady, onEvent, onTick, ref }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runnerRef = useRef<RaceRunner | null>(null);
  const callbacks = useRef({ onReady, onEvent, onTick });
  useEffect(() => {
    callbacks.current = { onReady, onEvent, onTick };
  });

  const entrantsKey = entrants.map((e) => `${e.slot}:${e.form ?? 0}`).join(",");

  useEffect(() => {
    let cancelled = false;
    // Signs and labels are drawn onto canvases, which only use a web font once it has loaded.
    const fontReady = document.fonts.load(`500 40px ${brandFamily()}`).catch(() => undefined);
    Promise.all([initPhysics(), fontReady]).then(() => {
      if (cancelled || !hostRef.current) return;
      const track = generateTrack(seed);
      runnerRef.current = new RaceRunner({
        host: hostRef.current,
        track,
        theme: themeByKey(theme),
        entrants,
        seed,
        eliminate,
        onEvent: (e) => callbacks.current.onEvent?.(e),
        onTick: (s) => callbacks.current.onTick?.(s),
      });
      callbacks.current.onReady?.(track);
    });
    return () => {
      cancelled = true;
      runnerRef.current?.dispose();
      runnerRef.current = null;
    };
    // entrantsKey stands in for `entrants` so a new array with the same field doesn't rebuild the race.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, theme, entrantsKey, eliminate]);

  useImperativeHandle(ref, () => ({ start: () => runnerRef.current?.start() }), []);

  return <div ref={hostRef} className="absolute inset-0 overflow-hidden" />;
}
