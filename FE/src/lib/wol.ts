export const WAKE_COOLDOWN_MS = 10_000;

/**
 * Normalize a MAC address to "AA:BB:CC:DD:EE:FF".
 * Accepts ":", "-", "." or no separators. Rejects all-zero, broadcast and multicast addresses.
 * Returns null when invalid.
 */
export function normalizeMac(input: string): string | null {
  const hex = input.trim().replace(/[:\-.\s]/g, "");
  if (!/^[0-9a-fA-F]{12}$/.test(hex)) return null;
  const up = hex.toUpperCase();
  if (up === "000000000000" || up === "FFFFFFFFFFFF") return null;
  if (parseInt(up.slice(0, 2), 16) & 1) return null; // multicast bit
  return up.match(/../g)!.join(":");
}

/** Milliseconds left before another wake request is allowed (0 = allowed). */
export function cooldownRemaining(
  lastWakeAt: number | null,
  now: number,
  cooldown = WAKE_COOLDOWN_MS,
) {
  if (lastWakeAt === null) return 0;
  return Math.max(0, lastWakeAt + cooldown - now);
}
