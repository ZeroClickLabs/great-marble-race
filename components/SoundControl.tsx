"use client";

/** Mute toggle + volume for the host screen. */
export function SoundControl({
  unlocked,
  muted,
  volume,
  onMuted,
  onVolume,
}: {
  unlocked: boolean;
  muted: boolean;
  volume: number;
  onMuted: (m: boolean) => void;
  onVolume: (v: number) => void;
}) {
  if (!unlocked)
    return (
      <button className="pointer-events-auto rounded-xl bg-gold px-3 py-2 text-sm font-bold text-ink shadow-lg">
        🔇 Click anywhere to turn on sound
      </button>
    );
  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-ink/85 px-3 py-2">
      <button onClick={() => onMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"} className="text-lg leading-none">
        {muted ? "🔇" : volume > 0.5 ? "🔊" : "🔉"}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={(e) => onVolume(Number(e.target.value))}
        aria-label="Volume"
        className="w-24 accent-lime"
      />
    </div>
  );
}
