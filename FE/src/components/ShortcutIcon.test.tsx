import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { ShortcutIcon } from "./ShortcutIcon";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const link = { id: "github", name: "GitHub", url: "https://github.com/" };

it("아이콘을 불러오는 중과 실패 시 사슬 아이콘을 표시한다", () => {
  vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue("/api/shortcuts/icons/github");
  const { container } = render(<ShortcutIcon link={link} />);
  const image = container.querySelector("img")!;
  expect(container.querySelector("svg")).toBeInTheDocument();
  fireEvent.error(image);
  expect(container.querySelector("img")).not.toBeInTheDocument();
  expect(container.querySelector("svg")).toBeInTheDocument();
});

it("저장된 아이콘이 로드되면 사슬 아이콘을 대신한다", () => {
  vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue("/api/shortcuts/icons/github");
  const { container } = render(<ShortcutIcon link={link} />);
  fireEvent.load(container.querySelector("img")!);
  expect(container.querySelector("svg")).not.toBeInTheDocument();
  expect(container.querySelector("img")).not.toHaveClass("opacity-0");
});

it("URL 변경 시 새 사이트의 아이콘을 다시 불러온다", () => {
  vi.spyOn(api.shortcuts, "iconUrl").mockImplementation(
    (link) => `/api/shortcuts/icons/${link.id}?site=${new URL(link.url).origin}`,
  );
  const { container, rerender } = render(<ShortcutIcon key={link.url} link={link} />);
  fireEvent.load(container.querySelector("img")!);
  const changed = { ...link, url: "https://react.dev/" };
  rerender(<ShortcutIcon key={changed.url} link={changed} />);
  expect(container.querySelector("svg")).toBeInTheDocument();
  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    "/api/shortcuts/icons/github?site=https://react.dev",
  );
});

it("시간 초과 후 화면에서 재시도해 뒤늦게 저장된 아이콘을 표시한다", () => {
  vi.useFakeTimers();
  vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue(
    "/api/shortcuts/icons/github?site=https://github.com",
  );
  const { container } = render(<ShortcutIcon link={link} />);
  fireEvent.error(container.querySelector("img")!);
  expect(container.querySelector("svg")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(5_000));
  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    "/api/shortcuts/icons/github?site=https://github.com&attempt=1",
  );
  fireEvent.load(container.querySelector("img")!);
  expect(container.querySelector("svg")).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(200_000));
  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    expect.stringContaining("attempt=1"),
  );
});

it("대기열 처리 시간을 고려해 재시도하되 없는 아이콘은 횟수를 제한한다", () => {
  vi.useFakeTimers();
  vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue("/api/shortcuts/icons/github");
  const { container } = render(<ShortcutIcon link={link} />);
  for (const [index, delay] of [5_000, 10_000, 20_000, 40_000, 60_000].entries()) {
    fireEvent.error(container.querySelector("img")!);
    act(() => vi.advanceTimersByTime(delay));
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      `/api/shortcuts/icons/github?attempt=${index + 1}`,
    );
  }
  fireEvent.error(container.querySelector("img")!);
  act(() => vi.advanceTimersByTime(1_000_000));
  expect(container.querySelector("img")).not.toBeInTheDocument();
  expect(container.querySelector("svg")).toBeInTheDocument();
});

it("URL 변경과 페이지 종료 시 이전 아이콘의 재시도 타이머를 정리한다", () => {
  vi.useFakeTimers();
  vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue("/api/shortcuts/icons/github");
  const { container, rerender, unmount } = render(<ShortcutIcon key={link.url} link={link} />);
  fireEvent.error(container.querySelector("img")!);
  expect(vi.getTimerCount()).toBe(1);
  const changed = { ...link, url: "https://react.dev/" };
  rerender(<ShortcutIcon key={changed.url} link={changed} />);
  expect(vi.getTimerCount()).toBe(0);
  fireEvent.error(container.querySelector("img")!);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
