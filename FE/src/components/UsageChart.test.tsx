import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageChart } from "./UsageChart";

beforeEach(() => vi.stubGlobal("PointerEvent", MouseEvent));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("사용률·네트워크 그래프", () => {
  const points = [
    { at: 0, value: 0 },
    { at: 5000, value: 42 },
    { at: 10000, value: 90 },
  ];
  function plotRect() {
    const plot = screen.getByRole("group", { name: /기록 탐색/ });
    vi.spyOn(plot, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 0,
      left: 100,
      right: 400,
      top: 0,
      bottom: 96,
      width: 300,
      height: 96,
      toJSON: () => ({}),
    });
    return plot;
  }
  it("그래프 위 커서에 해당하는 시간과 사용률을 표시하고 벗어나면 닫는다", () => {
    render(<UsageChart label="CPU" range="1m" points={points} from={0} to={10000} />);
    const plot = plotRect();
    fireEvent.pointerMove(plot, { clientX: 250 });
    expect(screen.getByRole("tooltip")).toHaveTextContent("09:00:05");
    expect(screen.getByRole("tooltip")).toHaveTextContent("42.0%");
    fireEvent.pointerMove(plot, { clientX: 50 });
    expect(screen.getByRole("tooltip")).toHaveTextContent("0.0%");
    fireEvent.pointerLeave(plot);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
  it("같은 시각의 Input·Output을 함께 표시하며 누락된 Input은 0으로 표시하지 않는다", () => {
    render(
      <UsageChart
        label="네트워크"
        range="1m"
        unit="bytesPerSecond"
        points={[
          { at: 0, value: 1024 },
          { at: 5000, value: null },
          { at: 10000, value: 2048 },
        ]}
        secondaryPoints={[
          { at: 0, value: 1048576 },
          { at: 5000, value: 2097152 },
          { at: 10000, value: 3145728 },
        ]}
        from={0}
        to={10000}
      />,
    );
    fireEvent.pointerMove(plotRect(), { clientX: 250 });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Input 기록 없음");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Output 2.0 MB/s");
  });
  it("키보드 탐색과 닫기를 지원하고 기간이 바뀌면 이전 툴팁을 지운다", () => {
    const { rerender } = render(
      <UsageChart label="CPU" range="1m" points={points} from={0} to={10000} />,
    );
    const plot = plotRect();
    fireEvent.focus(plot);
    expect(screen.getByRole("tooltip")).toHaveTextContent("90.0%");
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("42.0%");
    fireEvent.keyDown(plot, { key: "Home" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("0.0%");
    fireEvent.keyDown(plot, { key: "End" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("90.0%");
    fireEvent.keyDown(plot, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.pointerDown(plot, { clientX: 250 });
    expect(screen.getByRole("tooltip")).toHaveTextContent("42.0%");
    rerender(<UsageChart label="CPU" range="1H" points={points} from={0} to={10000} />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
  it("Input 기록이 없고 Output만 있어도 전송량과 선을 표시한다", () => {
    const { container } = render(
      <UsageChart
        label="네트워크"
        range="1m"
        unit="bytesPerSecond"
        points={[]}
        secondaryPoints={[
          { at: 0, value: 1024 * 1024 },
          { at: 1, value: 2 * 1024 * 1024 },
        ]}
        from={0}
        to={1}
      />,
    );
    expect(screen.getByRole("figure", { name: "네트워크 1m 전송량 그래프" })).toHaveTextContent(
      "Input —, Output 2.0 MB/s",
    );
    expect(screen.queryByText("기록 없음")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("누락된 기록을 0% 선으로 표시하지 않는다", () => {
    const { container } = render(
      <UsageChart
        label="디스크"
        range="1D"
        points={[
          { at: 0, value: null },
          { at: 1, value: null },
        ]}
        from={0}
        to={1}
        empty="사용량 미지원"
      />,
    );
    expect(screen.getByText("사용량 미지원")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
});
