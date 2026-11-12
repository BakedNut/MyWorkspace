import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import type { Timetable } from "@/types/domain";
import { TimetableDialog } from "./TimetableDialog";

const timetable: Timetable = {
  semesterStart: "2026-09-01",
  semesterEnd: "2026-12-20",
  courses: [
    {
      id: "old",
      name: "기존 수업",
      room: "6201",
      weekday: 2,
      start: "09:00",
      end: "11:50",
      cancelledDates: ["2026-11-10"],
    },
  ],
};

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onOpenChange = vi.fn();
  const view = (data: Timetable, open = true) => (
    <QueryClientProvider client={client}>
      <TimetableDialog open={open} onOpenChange={onOpenChange} timetable={data} />
    </QueryClientProvider>
  );
  return { ...render(view(timetable)), view, onOpenChange };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("시간표 표 편집 모달", () => {
  it("한 수업에 다른 요일의 시간을 추가하고 이름을 함께 수정한다", async () => {
    const save = vi.spyOn(api.timetable, "save").mockResolvedValue(timetable);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "시간 추가" }));
    fireEvent.change(screen.getByLabelText("요일", { exact: true }), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("과목명"), { target: { value: "TCP/IP" } });
    fireEvent.click(screen.getByRole("button", { name: "시간표 저장" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const courses = save.mock.calls[0]?.[0].courses;
    expect(courses).toHaveLength(1);
    expect(courses?.[0]).toMatchObject({
      name: "TCP/IP",
      weekday: 2,
      cancelledDates: ["2026-11-10"],
      additionalTimes: [expect.objectContaining({ weekday: 4, start: "09:00", end: "11:50" })],
    });
  });
  it("빈 칸에서 수업을 만들어 교수명·분 단위 시간과 기존 휴강일을 저장한다", async () => {
    const save = vi.spyOn(api.timetable, "save").mockResolvedValue(timetable);
    const { onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "월요일 18:30 수업 추가" }));
    fireEvent.change(screen.getByLabelText("과목명"), { target: { value: "과정지도" } });
    fireEvent.change(screen.getByLabelText("교수명"), { target: { value: "임충규" } });
    fireEvent.change(screen.getByLabelText("강의실"), { target: { value: "6201" } });
    fireEvent.change(screen.getByLabelText("시작 분"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("종료 분"), {
      target: { value: "15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "시간표 저장" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(save.mock.calls[0]?.[0].courses).toEqual([
      timetable.courses[0],
      expect.objectContaining({
        name: "과정지도",
        professor: "임충규",
        room: "6201",
        weekday: 1,
        start: "18:25",
        end: "19:15",
      }),
    ]);
    expect(timetable.courses).toHaveLength(1);
  });

  it("분 선택은 5분 간격이며 기존 비정규 시각은 반올림하지 않는다", () => {
    const { rerender, view } = setup();
    const minutes = screen.getByLabelText<HTMLSelectElement>("시작 분");
    expect(Array.from(minutes.options, (o) => o.value)).toEqual([
      "00",
      "05",
      "10",
      "15",
      "20",
      "25",
      "30",
      "35",
      "40",
      "45",
      "50",
      "55",
    ]);
    rerender(view(timetable, false));
    rerender(
      view({
        ...timetable,
        courses: timetable.courses.map((c) => ({ ...c, start: "09:07", end: "11:52" })),
      }),
    );
    expect(screen.getByLabelText("시작 분")).toHaveValue("07");
    expect(screen.getByRole("option", { name: "07분 (기존)" })).toBeDisabled();
    expect(screen.getByLabelText("종료 분")).toHaveValue("52");
    fireEvent.change(screen.getByLabelText("시작 분"), { target: { value: "10" } });
    expect(screen.getByLabelText("시작 분")).toHaveValue("10");
  });

  it("중복 수업의 저장을 막고 서버 저장 실패에도 입력을 유지한다", async () => {
    const save = vi.spyOn(api.timetable, "save").mockRejectedValue(new Error("네트워크 오류"));
    const { onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "수업 추가" }));
    fireEvent.change(screen.getByLabelText("과목명"), { target: { value: "새 수업" } });
    fireEvent.change(screen.getByLabelText("요일", { exact: true }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "시간표 저장" }));
    expect(screen.getByRole("alert")).toHaveTextContent("시간이 겹칩니다");
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("요일", { exact: true }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "시간표 저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("네트워크 오류"));
    expect(screen.getByLabelText("과목명")).toHaveValue("새 수업");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("백그라운드 갱신에서 초안을 보존하고 다시 열면 미저장 편집을 버린다", () => {
    const { rerender, view, onOpenChange } = setup();
    fireEvent.change(screen.getByLabelText("과목명"), { target: { value: "수정 중" } });
    rerender(view(structuredClone(timetable)));
    expect(screen.getByLabelText("과목명")).toHaveValue("수정 중");
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(view(timetable, false));
    rerender(view(timetable));
    expect(screen.getByLabelText("과목명")).toHaveValue("기존 수업");
  });
});
