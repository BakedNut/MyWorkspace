import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import { seedCalendars } from "@/api/mock/seed";
import { EventDialog } from "./EventDialog";

beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <EventDialog
        open
        onOpenChange={onOpenChange}
        calendars={seedCalendars()}
        defaults={{ date: "2026-11-06" }}
      />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

describe("통합 일정 추가 모달", () => {
  it("일반 일정으로 시작하며 종일을 전환해도 입력한 시각을 보존한다", async () => {
    const create = vi
      .spyOn(api.calendar, "createEvent")
      .mockImplementation(async (input) => ({ ...input, id: "new" }));
    const close = setup();
    expect(screen.getByRole("switch", { name: "종일" })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "수업 준비" } });
    fireEvent.change(screen.getByLabelText("시작"), { target: { value: "09:25" } });
    fireEvent.click(screen.getByRole("switch", { name: "종일" }));
    expect(screen.queryByLabelText("시작")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "종일" }));
    expect(screen.getByLabelText("시작")).toHaveValue("09:25");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      allDay: false,
      date: "2026-11-06",
      start: "09:25",
      end: "11:00",
    });
  });

  it("종일 일정은 시간 없이 저장하며 실패하면 제목과 토글을 유지한다", async () => {
    const create = vi.spyOn(api.calendar, "createEvent").mockRejectedValue(new Error("저장 실패"));
    const close = setup();
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "종일 약속" } });
    fireEvent.click(screen.getByRole("switch", { name: "종일" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("저장 실패"));
    const input = create.mock.calls[0]?.[0];
    expect(input).toMatchObject({ title: "종일 약속", allDay: true });
    expect(input).not.toHaveProperty("start");
    expect(input).not.toHaveProperty("end");
    expect(screen.getByLabelText("제목")).toHaveValue("종일 약속");
    expect(screen.getByRole("switch", { name: "종일" })).toBeChecked();
    expect(close).not.toHaveBeenCalled();
  });
});
