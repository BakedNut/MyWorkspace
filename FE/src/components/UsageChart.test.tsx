import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UsageChart } from "./UsageChart";

afterEach(cleanup);

describe("사용률·네트워크 그래프", () => {
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
