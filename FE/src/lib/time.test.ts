import { describe, expect, it } from "vitest";
import { clock12 } from "./time";

describe("12시간 시계", () => {
  it.each([
    ["00:00", "오전", "12:00"],
    ["11:59", "오전", "11:59"],
    ["12:00", "오후", "12:00"],
    ["23:25", "오후", "11:25"],
  ])("%s를 변환한다", (input, period, time) => {
    expect(clock12(input!)).toEqual({ period, time });
  });
});
