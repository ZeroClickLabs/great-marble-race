import { marbleBySlot } from "@/lib/race/marbles";

export function MarbleDot({ slot, size = 16 }: { slot: number; size?: number }) {
  const m = marbleBySlot(slot);
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 32% 30%, #ffffffcc 0 12%, ${m.color} 38%, color-mix(in oklab, ${m.color} 60%, black) 100%)`,
        boxShadow: `0 0 0 1.5px ${m.accent}55`,
      }}
    />
  );
}

export function MarbleChip({ slot, className = "" }: { slot: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <MarbleDot slot={slot} />
      <span className="truncate">{marbleBySlot(slot).name}</span>
    </span>
  );
}
