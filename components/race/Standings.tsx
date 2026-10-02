import { MarbleDot } from "@/components/MarbleChip";
import { marbleBySlot } from "@/lib/race/marbles";
import type { RaceSnapshot } from "@/lib/race/runner";

/** Broadcast-style standings column. The bottom `eliminate` places are the danger zone. */
export function Standings({ snap, eliminate }: { snap: RaceSnapshot; eliminate: number }) {
  const cut = snap.standings.length - eliminate;
  const leaderProgress = snap.progress[snap.standings[0]] ?? 0;
  return (
    <ol className="flex flex-col gap-[3px] w-60">
      {snap.standings.map((slot, i) => {
        const done = snap.finished.includes(slot);
        const danger = i >= cut;
        const gap = leaderProgress - (snap.progress[slot] ?? 0);
        return (
          <li
            key={slot}
            className={`flex items-center gap-2 rounded-md px-2 py-[3px] text-sm backdrop-blur-sm transition-colors ${
              danger ? (snap.phase === "running" ? "pulse-danger bg-danger/20" : "bg-danger/30") : "bg-ink/88"
            } ${i === cut && cut > 0 ? "mt-2" : ""}`}
          >
            <span className="font-display w-5 text-right text-base font-bold tabular text-muted">{i + 1}</span>
            <MarbleDot slot={slot} size={14} />
            <span className="flex-1 truncate font-semibold">{marbleBySlot(slot).name}</span>
            <span className="tabular text-xs text-muted">
              {done ? "🏁" : i === 0 ? `${Math.round(leaderProgress * 100)}%` : `-${Math.round(gap * 100)}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
