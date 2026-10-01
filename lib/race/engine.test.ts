import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics, Race } from "./engine";
import { generateTrack } from "./track";

const entrants = Array.from({ length: 16 }, (_, slot) => ({ slot }));

function run(seed: number, field = entrants, safeSpots = field.length) {
  const race = new Race(generateTrack(seed), field, seed, safeSpots);
  for (let i = 0; i < 60; i++) race.step(); // settle on the grid
  race.start();
  const events = [];
  while (race.phase !== "done") {
    race.step();
    events.push(...race.drain());
  }
  const result = { order: [...race.standings], finished: race.finishOrder.length, time: race.time, events, length: race.track.length };
  race.dispose();
  return result;
}

describe("race engine", () => {
  beforeAll(() => initPhysics());

  it("calls the race once the safe spots are filled", () => {
    const final = run(7, entrants.slice(0, 3), 1);
    expect(final.finished).toBeGreaterThanOrEqual(1);
    const winnerTime = final.events.find((e) => e.type === "finished")!.time;
    expect(final.time - winnerTime).toBeLessThan(3);
  });

  it("is deterministic for a seed", () => {
    expect(run(42).order).toEqual(run(42).order);
  });

  it("finishes races with every marble ranked", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = run(seed, entrants, 12);
      const winnerTime = r.events.find((e) => e.type === "finished")?.time;
      console.log(`seed ${seed}: length ${r.length.toFixed(0)}, winner ${winnerTime?.toFixed(1)}s, finished ${r.finished}/16, total ${r.time.toFixed(1)}s, checkpoints ${r.events.filter((e) => e.type === "checkpoint").length}, leadChanges ${r.events.filter((e) => e.type === "lead_change").length}`);
      expect(new Set(r.order).size).toBe(16);
      expect(r.time).toBeLessThan(120);
      // Finishers keep their finishing order at the top of the standings.
      expect(r.order.slice(0, r.finished)).toEqual(r.events.filter((e) => e.type === "finished").map((e) => e.slot));
    }
  });
});
