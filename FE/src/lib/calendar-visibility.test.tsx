import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "@/api";
import { useCalendarVisibility } from "./calendar-visibility";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useCalendarVisibility(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
it("서버에 저장한 선택을 새 화면에서도 불러오고 다른 캘린더의 선택을 보존한다", async () => {
  let saved = { hiddenCalendarIds: ["__school"] };
  vi.spyOn(api.calendar, "getVisibility").mockImplementation(async () => saved);
  const save = vi.spyOn(api.calendar, "saveVisibility").mockImplementation(async (input) => {
    saved = input;
    return saved;
  });
  const first = setup();
  await waitFor(() => expect(first.result.current.query.isSuccess).toBe(true));
  expect(first.result.current.hidden.has("__school")).toBe(true);
  act(() => first.result.current.toggle("cal-remote"));
  await waitFor(() => expect(first.result.current.hidden.has("cal-remote")).toBe(true));
  expect(save).toHaveBeenCalledExactlyOnceWith({ hiddenCalendarIds: ["__school", "cal-remote"] });
  first.unmount();
  const next = setup();
  await waitFor(() => expect(next.result.current.hidden.size).toBe(2));
  act(() => next.result.current.toggle("__school"));
  await waitFor(() => expect(next.result.current.hidden.has("__school")).toBe(false));
  expect(next.result.current.hidden.has("cal-remote")).toBe(true);
});
it("저장 중 중복 요청을 막고 실패하면 서버의 이전 선택을 유지한다", async () => {
  vi.spyOn(api.calendar, "getVisibility").mockResolvedValue({ hiddenCalendarIds: ["__school"] });
  let reject!: (error: Error) => void;
  const save = vi.spyOn(api.calendar, "saveVisibility").mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const { result } = setup();
  await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
  act(() => result.current.toggle("cal-remote"));
  await waitFor(() => expect(result.current.saving).toBe(true));
  act(() => result.current.toggle("__school"));
  expect(save).toHaveBeenCalledTimes(1);
  act(() => reject(new ApiError("저장 실패", "NETWORK")));
  await waitFor(() => expect(result.current.saveError).toBeTruthy());
  expect([...result.current.hidden]).toEqual(["__school"]);
});
it("조회 실패 상태에서는 기본값으로 설정을 덮어쓰지 않는다", async () => {
  vi.spyOn(api.calendar, "getVisibility").mockRejectedValue(new ApiError("조회 실패", "NETWORK"));
  const save = vi.spyOn(api.calendar, "saveVisibility");
  const { result } = setup();
  await waitFor(() => expect(result.current.query.isError).toBe(true));
  act(() => result.current.toggle("__school"));
  expect(save).not.toHaveBeenCalled();
});
