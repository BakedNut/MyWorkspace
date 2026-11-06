import { describe, expect, it } from "vitest";
import { cooldownRemaining, normalizeMac, normalizeWolList } from "./wol";

describe("WOL 입력과 재요청 제한", () => {
  it("PC 목록의 이름과 MAC을 정규화하고 중복·잘못된 입력을 거부한다", () => {
    const first = { id: "a", name: " 내 PC ", mac: "3c7c3f12abcd" };
    expect(normalizeWolList([first])).toEqual([
      { ...first, name: "내 PC", mac: "3C:7C:3F:12:AB:CD" },
    ]);
    expect(normalizeWolList([])).toEqual([]);
    expect(() => normalizeWolList([first, { ...first, id: "b" }])).toThrow("이미 등록");
    expect(() => normalizeWolList([first, { ...first, mac: null }])).toThrow("식별자");
    expect(() => normalizeWolList([{ ...first, name: " " }])).toThrow("이름");
    expect(() => normalizeWolList([{ ...first, mac: "invalid" }])).toThrow("MAC");
  });
  it.each(["3c:7c:3f:12:ab:cd", "3C-7C-3F-12-AB-CD", "3c7c3f12abcd", "3c7c.3f12.abcd"])(
    "MAC 주소를 정규화한다: %s",
    (value) => {
      expect(normalizeMac(value)).toBe("3C:7C:3F:12:AB:CD");
    },
  );

  it.each([
    "",
    "not-a-mac",
    "0011223344",
    "00:00:00:00:00:00",
    "FF:FF:FF:FF:FF:FF",
    "01:00:5E:00:00:01",
  ])("유효하지 않은 목적지를 거부한다: %s", (value) => {
    expect(normalizeMac(value)).toBeNull();
  });

  it("첫 요청과 정확히 10초가 지난 요청을 허용한다", () => {
    expect(cooldownRemaining(null, 0)).toBe(0);
    expect(cooldownRemaining(0, 9999)).toBe(1);
    expect(cooldownRemaining(0, 10000)).toBe(0);
  });
});
