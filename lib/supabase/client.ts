"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabase() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local");
    client = createClient(url, key, { realtime: { params: { eventsPerSecond: 20 } } });
  }
  return client;
}

/** Everyone plays as an anonymous Supabase user; the session persists in localStorage. */
export async function ensureSession(): Promise<string> {
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: signed, error } = await sb.auth.signInAnonymously();
  if (error || !signed.user) throw error ?? new Error("Could not sign in");
  return signed.user.id;
}

/** Postgres errors from RPCs carry a readable message; strip the noise. */
export function errorMessage(e: unknown) {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : String(e);
  // Browser-level network failures surface as "TypeError: Load failed" etc. — say what actually happened.
  if (/^(TypeError|FetchError)\b|Load failed|Failed to fetch|NetworkError/i.test(msg)) {
    return "Connection dropped — check your signal and try again";
  }
  if (/Betting is closed/i.test(msg)) return "Too late — betting just closed on that one";
  return msg;
}
