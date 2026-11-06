import { afterEach, expect, it, vi } from "vitest";
import { clearLegacyStorage } from "./legacy-storage";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("이전 시안 데이터와 가져오기 표시만 삭제하고 반복 실행해도 안전하다", () => {
  for (const key of ["events", "timetable", "wol", "session", "calendars", "controls"]) {
    localStorage.setItem(`myworkspace.mock.v1.${key}`, "old");
  }
  localStorage.setItem("myworkspace.imported.v1", "true");
  localStorage.setItem("unrelated-setting", "keep");
  clearLegacyStorage();
  clearLegacyStorage();
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem("unrelated-setting")).toBe("keep");
});

it("브라우저가 저장소 접근을 차단해도 페이지 실행을 막지 않는다", () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  expect(() => clearLegacyStorage()).not.toThrow();
});
