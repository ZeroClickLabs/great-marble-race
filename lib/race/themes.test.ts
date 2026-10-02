import { describe, expect, it } from "vitest";
import { GAME_PRESETS } from "@/lib/game/types";
import { THEMES, themeForRound } from "./themes";

describe("theme rotation", () => {
  for (const [name, preset] of Object.entries(GAME_PRESETS)) {
    it(`${name}: grand final gets the finale theme, earlier races rotate without repeats`, () => {
      for (const id of ["game-a", "game-b", "XJQB-1234"]) {
        const game = { id, config: { eliminations: [...preset.eliminations] } };
        const rounds = preset.eliminations.length;
        const keys = Array.from({ length: rounds }, (_, i) => themeForRound(game, i + 1).key);
        expect(keys[rounds - 1]).toBe("coterie");
        expect(keys.slice(0, -1)).not.toContain("coterie");
        for (let i = 1; i < rounds - 1; i++) expect(keys[i]).not.toBe(keys[i - 1]);
      }
    });
  }

  it("has exactly one finale theme", () => {
    expect(THEMES.filter((t) => t.finale).map((t) => t.key)).toEqual(["coterie"]);
  });
});
