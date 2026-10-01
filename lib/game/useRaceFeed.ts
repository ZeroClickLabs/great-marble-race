"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { raceChannelName } from "./useGame";
import type { RaceCaption, RaceTick } from "./types";

/** Phones: listen to the host's live race broadcast. */
export function useRaceFeed(gameId: string | undefined) {
  const [tick, setTick] = useState<RaceTick | null>(null);
  const [captions, setCaptions] = useState<RaceCaption[]>([]);
  useEffect(() => {
    if (!gameId) return;
    const sb = supabase();
    const channel = sb
      .channel(raceChannelName(gameId))
      .on("broadcast", { event: "tick" }, ({ payload }) => setTick(payload as RaceTick))
      .on("broadcast", { event: "caption" }, ({ payload }) =>
        setCaptions((c) => [{ ...(payload as RaceCaption), at: Date.now() }, ...c].slice(0, 6)),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [gameId]);
  return { tick, captions };
}

/** Host: publish race data to phones. */
export function useRaceBroadcaster(gameId: string | undefined) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  useEffect(() => {
    if (!gameId) return;
    const sb = supabase();
    const channel = sb.channel(raceChannelName(gameId), { config: { broadcast: { self: false } } }).subscribe();
    channelRef.current = channel;
    return () => {
      sb.removeChannel(channel);
      channelRef.current = null;
    };
  }, [gameId]);
  return {
    tick: (t: RaceTick) => channelRef.current?.send({ type: "broadcast", event: "tick", payload: t }),
    caption: (c: RaceCaption) => channelRef.current?.send({ type: "broadcast", event: "caption", payload: c }),
  };
}

/** Re-renders every `ms` and returns Date.now(). */
export function useNow(ms = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
