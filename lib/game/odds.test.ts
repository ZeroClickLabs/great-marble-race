import { describe, expect, it } from "vitest";
import { multiplier, poolsFor, potSize, settlePayout } from "./odds";

const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ key: String(i), label: `M${i}` }));
const market = { id: "m", options: opts(4), seed_pool: 50, winners_expected: 1 };

describe("pari-mutuel odds", () => {
  it("starts even across options", () => {
    const pools = poolsFor(market, []);
    expect(potSize(market, pools)).toBe(200);
    expect(multiplier(market, pools, "0")).toBeCloseTo(4);
  });

  it("shortens the favourite as money comes in", () => {
    const pools = poolsFor(market, [{ market_id: "m", option: "0", amount: 150 }]);
    expect(multiplier(market, pools, "0")).toBeCloseTo(350 / 200);
    expect(multiplier(market, pools, "1")).toBeCloseTo(350 / 50);
  });

  it("splits the pot between winning bets in proportion to stake", () => {
    const bets = [
      { market_id: "m", option: "0", amount: 100 },
      { market_id: "m", option: "0", amount: 300 },
      { market_id: "m", option: "1", amount: 200 },
    ];
    const pools = poolsFor(market, bets);
    // pot 600 + 200 seed = 800; winning side 400 + 50 seed = 450
    expect(settlePayout(market, pools, ["0"], bets[0])).toBe(Math.floor((100 * 800) / 450));
    expect(settlePayout(market, pools, ["0"], bets[1])).toBe(Math.floor((300 * 800) / 450));
    expect(settlePayout(market, pools, ["0"], bets[2])).toBe(0);
  });

  it("a lone winning bettor still profits from the seed", () => {
    const bets = [{ market_id: "m", option: "2", amount: 10 }];
    const pools = poolsFor(market, bets);
    expect(settlePayout(market, pools, ["2"], bets[0])).toBe(Math.floor((10 * 210) / 60));
  });

  it("handles several winners and no bets on the winners", () => {
    const elim = { ...market, winners_expected: 2 };
    const pools = poolsFor(elim, [{ market_id: "m", option: "0", amount: 100 }]);
    expect(multiplier(elim, pools, "1")).toBeGreaterThan(1);
    expect(settlePayout(elim, pools, ["1", "2"], { option: "0", amount: 100 })).toBe(0);
  });
});
