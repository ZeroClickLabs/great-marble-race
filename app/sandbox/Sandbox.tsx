"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { Standings } from "@/components/race/Standings";
import type { RaceStageHandle } from "@/components/race/RaceStage";
import type { RaceEvent } from "@/lib/race/engine";
import { marbleBySlot } from "@/lib/race/marbles";
import type { RaceSnapshot } from "@/lib/race/runner";
import { randomSeed } from "@/lib/race/rng";

const RaceStage = dynamic(() => import("@/components/race/RaceStage"), { ssr: false });

const ENTRANTS = Array.from({ length: 16 }, (_, slot) => ({ slot }));

function describe(e: RaceEvent) {
  switch (e.type) {
    case "start": return "And they're off!";
    case "checkpoint": return `${marbleBySlot(e.leader).name} leads at checkpoint ${e.index + 1}`;
    case "lead_change": return `${marbleBySlot(e.leader).name} takes the lead from ${marbleBySlot(e.previous).name}`;
    case "boost": return `${marbleBySlot(e.slot).name} hits the boost pad`;
    case "finished": return `${e.place}. ${marbleBySlot(e.slot).name} (${e.time.toFixed(1)}s)`;
    case "race_over": return "Race over";
  }
}

/** Dev page for tuning tracks and cameras without a game backend. */
export default function Sandbox() {
  const [seed, setSeed] = useState(1);
  const [snap, setSnap] = useState<RaceSnapshot | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const stage = useRef<RaceStageHandle>(null);

  return (
    <div className="relative h-dvh w-full">
      <RaceStage
        ref={stage}
        seed={seed}
        entrants={ENTRANTS}
        eliminate={4}
        onTick={setSnap}
        onEvent={(e) => e.type !== "boost" && setLog((l) => [describe(e), ...l].slice(0, 12))}
      />
      <div className="absolute left-4 top-4">{snap && <Standings snap={snap} eliminate={4} />}</div>
      <div className="absolute right-4 top-4 flex w-72 flex-col gap-2 rounded-lg bg-ink/80 p-3 text-sm">
        <div className="flex gap-2">
          <button className="rounded bg-lime px-3 py-1 font-bold text-ink" onClick={() => stage.current?.start()}>
            Start
          </button>
          <button
            className="rounded bg-panel-2 px-3 py-1"
            onClick={() => {
              setSeed(randomSeed());
              setLog([]);
              setSnap(null);
            }}
          >
            New track
          </button>
          <span className="self-center tabular text-muted">seed {seed}</span>
        </div>
        <div className="tabular">t = {snap?.time.toFixed(1)}s {snap?.slowMo && "· SLOW-MO"}</div>
        <ul className="text-muted">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
