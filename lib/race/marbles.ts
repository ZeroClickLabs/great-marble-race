export type MarblePattern = "solid" | "stripe" | "swirl" | "dots";

export interface MarbleDef {
  slot: number;
  name: string;
  color: string;
  accent: string;
  pattern: MarblePattern;
}

export const MARBLES: readonly MarbleDef[] = [
  { slot: 0, name: "Big Red", color: "#e23b3b", accent: "#ffd6d6", pattern: "solid" },
  { slot: 1, name: "Minty", color: "#3fd6a0", accent: "#ffffff", pattern: "swirl" },
  { slot: 2, name: "Shadow", color: "#2b2b38", accent: "#8a7dff", pattern: "stripe" },
  { slot: 3, name: "Bumblebee", color: "#ffd21f", accent: "#1d1d1d", pattern: "stripe" },
  { slot: 4, name: "Blue Moon", color: "#2f6bff", accent: "#cfe0ff", pattern: "dots" },
  { slot: 5, name: "Tangerine", color: "#ff8a1f", accent: "#fff1de", pattern: "solid" },
  { slot: 6, name: "Pinky", color: "#ff6fcf", accent: "#ffffff", pattern: "dots" },
  { slot: 7, name: "Grape Escape", color: "#8a3ffc", accent: "#e8dcff", pattern: "swirl" },
  { slot: 8, name: "Snowball", color: "#f2f5fa", accent: "#7fb8ff", pattern: "swirl" },
  { slot: 9, name: "Limelight", color: "#a6e22e", accent: "#2f4a00", pattern: "stripe" },
  { slot: 10, name: "Copperhead", color: "#b8672e", accent: "#ffcf9e", pattern: "stripe" },
  { slot: 11, name: "Tealtime", color: "#14a3a8", accent: "#c8fbff", pattern: "solid" },
  { slot: 12, name: "Midnight", color: "#1b2a6b", accent: "#ffe066", pattern: "dots" },
  { slot: 13, name: "Rusty", color: "#8c2f1b", accent: "#e8a07a", pattern: "swirl" },
  { slot: 14, name: "Glacier", color: "#9fe3ff", accent: "#ffffff", pattern: "stripe" },
  { slot: 15, name: "Goldie", color: "#d4a514", accent: "#fff6c8", pattern: "solid" },
];

export const marbleBySlot = (slot: number) => MARBLES[slot];
