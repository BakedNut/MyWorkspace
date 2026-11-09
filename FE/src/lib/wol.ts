import type { WolDevice } from "@/types/domain";

export const WAKE_COOLDOWN_MS = 10_000;

export function normalizeWolList(devices: WolDevice[]): WolDevice[] {
  const ids = new Set<string>();
  const macs = new Set<string>();
  return devices.map((device, index) => {
    const name = device.name.trim();
    if (!name || name.length > 64)
      throw new Error(`${index + 1}번째 PC 이름을 1~64자로 입력하세요.`);
    if (!device.id || ids.has(device.id)) throw new Error("PC 식별자가 중복되거나 비어 있습니다.");
    ids.add(device.id);
    const mac = device.mac === null ? null : normalizeMac(device.mac);
    if (device.mac !== null && !mac) throw new Error(`${name}: 올바른 MAC 주소를 입력하세요.`);
    if (mac && macs.has(mac)) throw new Error(`${name}: 이미 등록한 MAC 주소입니다.`);
    if (mac) macs.add(mac);
    return { ...device, name, mac };
  });
}

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
