"use client";

import { useState, useSyncExternalStore } from "react";
import { NICKNAME_KEY } from "./api";

function readStored() {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

const noopSubscribe = () => () => {};

/** Nickname input state, pre-filled with the name used last time on this device. */
export function useStoredNickname() {
  const stored = useSyncExternalStore(noopSubscribe, readStored, () => "");
  const [typed, setTyped] = useState<string | null>(null);
  const remember = (name: string) => {
    try {
      localStorage.setItem(NICKNAME_KEY, name);
    } catch {}
  };
  return [typed ?? stored, setTyped, remember] as const;
}
