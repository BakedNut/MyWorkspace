import { describe, expect, it } from "vitest";
import { sampleServerHistory } from "@/api/mock/server-history";
import { formatRate, HISTORY_WINDOWS, usagePath } from "./server-history";
import type { ServerRange } from "@/types/domain";

describe("사용률 기록", () => {
  it("네트워크는 백분율로 자르지 않고 바이트/초 단위로 그린다", () => {
    expect(
      usagePath(
        [
          { at: 0, value: 1_000_000 },
          { at: 1, value: 2_000_000 },
        ],
        0,
        1,
        2_000_000,
      ),
    ).toBe("M0.00,44.00 L300.00,0.00");
    expect(formatRate(0)).toBe("0 B/s");
    expect(formatRate(1024)).toBe("1.0 KB/s");
    expect(formatRate(1024 ** 2)).toBe("1.0 MB/s");
    expect(formatRate(NaN)).toBe("—");
  });
  it("범위를 넘는 사용률을 제한하고 누락된 구간을 연결하지 않는다", () => {
    expect(
      usagePath(
        [
          { at: 0, value: 0 },
          { at: 1, value: null },
          { at: 2, value: 120 },
        ],
        0,
        2,
      ),
    ).toBe("M0.00,88.00  M300.00,0.00");
    expect(usagePath([{ at: 0, value: NaN }], 0, 1)).toBe("");
    expect(usagePath([], 1, 1)).toBe("");
  });
  it("각 기간의 시안 기록은 지정 범위와 해상도를 따르고 중지된 게스트를 꾸미지 않는다", () => {
    for (const range of Object.keys(HISTORY_WINDOWS) as ServerRange[]) {
      const history = sampleServerHistory(range, 1800000000000);
      const spec = HISTORY_WINDOWS[range];
      expect(history.to - history.from).toBe(spec.duration);
      expect(history.host.cpu).toHaveLength(spec.duration / spec.step + 1);
      expect(history.host.cpu.at(-1)?.at).toBe(history.to);
      expect(
        history.host.cpu.every((p) => p.value !== null && p.value >= 0 && p.value <= 100),
      ).toBe(true);
      expect(history.guests["vm-101"]?.cpu).toEqual([]);
      expect(history.guests["vm-101"]?.input).toEqual([]);
      expect(history.guests["vm-101"]?.disk).toEqual([]);
      expect(history.host.input.at(-1)?.value).toBe(2_600_000);
      expect(history.host.output.at(-1)?.value).toBe(810_000);
      expect(history.guests["lxc-200"]?.disk).toHaveLength(spec.duration / spec.step + 1);
      expect(
        history.guests["lxc-200"]?.disk.every(
          (p) => p.value !== null && p.value >= 0 && p.value <= 100,
        ),
      ).toBe(true);
    }
  });
});
