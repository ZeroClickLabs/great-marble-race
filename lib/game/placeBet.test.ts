import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ supabase: () => ({ rpc }) }));

const { placeBet, isNetworkError } = await import("./api");

const dropped = { message: "TypeError: Load failed", code: "" };
const closed = { message: "Betting is closed for this market", code: "P0001" };

describe("placeBet", () => {
  beforeEach(() => rpc.mockReset());

  it("retries dropped requests with the same bet id", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: dropped });
    rpc.mockResolvedValueOnce({ data: null, error: dropped });
    rpc.mockResolvedValueOnce({ data: { id: "bet-1" }, error: null });
    await expect(placeBet("m", "yes", 50)).resolves.toEqual({ id: "bet-1" });
    expect(rpc).toHaveBeenCalledTimes(3);
    const ids = rpc.mock.calls.map(([, args]) => args.p_client_id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not retry when the server says no", async () => {
    rpc.mockResolvedValue({ data: null, error: closed });
    await expect(placeBet("m", "yes", 50)).rejects.toEqual(closed);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("gives up after a few network failures", async () => {
    rpc.mockResolvedValue({ data: null, error: dropped });
    await expect(placeBet("m", "yes", 50)).rejects.toEqual(dropped);
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it("falls back to the old function when the database isn't migrated", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Could not find the function", code: "PGRST202" } });
    rpc.mockResolvedValueOnce({ data: { id: "bet-2" }, error: null });
    await expect(placeBet("m", "yes", 50)).resolves.toEqual({ id: "bet-2" });
    expect(rpc.mock.calls[1][1]).not.toHaveProperty("p_client_id");
  });

  it("recognises browser network errors", () => {
    expect(isNetworkError({ message: "TypeError: Load failed" })).toBe(true);
    expect(isNetworkError({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(isNetworkError(closed)).toBe(false);
  });
});
