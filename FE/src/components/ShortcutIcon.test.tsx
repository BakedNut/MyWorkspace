import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { ShortcutIcon } from "./ShortcutIcon";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500 }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

it("시간 초과 후 화면에서 재시도해 뒤늦게 저장된 아이콘을 표시한다", async () => {
  vi.mocked(fetch).mockResolvedValue({ status: 200 } as Response);
  vi.useFakeTimers();
  vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue(
    "/api/shortcuts/icons/github?site=https://github.com",
  );
  const { container } = render(<ShortcutIcon link={link} />);
  await act(async () => fireEvent.error(container.querySelector("img")!));
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

it.each([200, 500])("일반 오류 응답 %i는 재시도 횟수를 제한한다", async (status) => {
  vi.mocked(fetch).mockResolvedValue({ status } as Response);
  vi.useFakeTimers();
  vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue("/api/shortcuts/icons/github");
  const { container } = render(<ShortcutIcon link={link} />);
  for (const [index, delay] of [5_000, 10_000, 20_000, 40_000, 60_000].entries()) {
    await act(async () => fireEvent.error(container.querySelector("img")!));
    act(() => vi.advanceTimersByTime(delay));
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      `/api/shortcuts/icons/github?attempt=${index + 1}`,
    );
  }
  await act(async () => fireEvent.error(container.querySelector("img")!));
  act(() => vi.advanceTimersByTime(1_000_000));
  expect(container.querySelector("img")).not.toBeInTheDocument();
  expect(container.querySelector("svg")).toBeInTheDocument();
});

it("URL 변경과 페이지 종료 시 이전 아이콘의 재시도 타이머를 정리한다", async () => {
  vi.useFakeTimers();
  vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue("/api/shortcuts/icons/github");
  const { container, rerender, unmount } = render(<ShortcutIcon key={link.url} link={link} />);
  await act(async () => fireEvent.error(container.querySelector("img")!));
  expect(vi.getTimerCount()).toBe(1);
  const changed = { ...link, url: "https://react.dev/" };
  rerender(<ShortcutIcon key={changed.url} link={changed} />);
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => fireEvent.error(container.querySelector("img")!));
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("수집 대기 상태에서는 다섯 번 뒤에도 재시도해 저장된 아이콘을 표시한다", async () => {
  vi.useFakeTimers();
  vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue("/api/shortcuts/icons/github");
  const probe = vi.fn().mockResolvedValue({ status: 202 });
  vi.stubGlobal("fetch", probe);
  const { container } = render(<ShortcutIcon link={link} />);
  for (const [index, delay] of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000].entries()) {
    await act(async () => fireEvent.error(container.querySelector("img")!));
    await act(async () => vi.advanceTimersByTime(delay));
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      `/api/shortcuts/icons/github?attempt=${index + 1}`,
    );
  }
  fireEvent.load(container.querySelector("img")!);
  expect(container.querySelector("svg")).not.toBeInTheDocument();
});

it.each([204, 401, 403, 404])(
  "완료된 아이콘 없음 또는 접근 거부 응답 %i에서는 재시도하지 않는다",
  async (status) => {
    vi.useFakeTimers();
    vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue("/api/shortcuts/icons/github");
    vi.mocked(fetch).mockResolvedValue({ status } as Response);
    const { container } = render(<ShortcutIcon link={link} />);
    await act(async () => fireEvent.error(container.querySelector("img")!));
    expect(fetch).toHaveBeenCalledWith(
      "/api/shortcuts/icons/github",
      expect.objectContaining({ method: "HEAD", cache: "no-store" }),
    );
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTime(1_000_000));
    expect(container.querySelector("img")).not.toBeInTheDocument();
  },
);

it("오래 대기한 뒤 완료된 아이콘 없음은 최종 대체 아이콘으로 표시한다", async () => {
  vi.useFakeTimers();
  vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue("/api/shortcuts/icons/github");
  vi.mocked(fetch).mockResolvedValue({ status: 202 } as Response);
  const { container } = render(<ShortcutIcon link={link} />);
  for (const delay of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
    await act(async () => fireEvent.error(container.querySelector("img")!));
    await act(async () => vi.advanceTimersByTime(delay));
  }
  vi.mocked(fetch).mockResolvedValue({ status: 204 } as Response);
  await act(async () => fireEvent.error(container.querySelector("img")!));
  expect(vi.getTimerCount()).toBe(0);
  expect(container.querySelector("svg")).toBeInTheDocument();
});

it("대기 횟수와 일반 통신 오류의 재시도 한도를 구분한다", async () => {
  vi.useFakeTimers();
  vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue("/api/shortcuts/icons/github");
  vi.mocked(fetch).mockResolvedValue({ status: 202 } as Response);
  const { container } = render(<ShortcutIcon link={link} />);
  for (const delay of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
    await act(async () => fireEvent.error(container.querySelector("img")!));
    await act(async () => vi.advanceTimersByTime(delay));
  }
  vi.mocked(fetch).mockRejectedValue(new TypeError("Network failed"));
  for (let index = 0; index < 5; index++) {
    await act(async () => fireEvent.error(container.querySelector("img")!));
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(container.querySelector("img")).toBeInTheDocument();
  }
  await act(async () => fireEvent.error(container.querySelector("img")!));
  expect(vi.getTimerCount()).toBe(0);
});

it("URL 변경 뒤 늦게 도착한 이전 상태 응답은 재시도를 생성하지 않는다", async () => {
  vi.useFakeTimers();
  vi.spyOn(api.shortcuts, "iconUrl").mockImplementation(
    (link) => `/api/shortcuts/icons/${link.id}?site=${new URL(link.url).origin}`,
  );
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValue(
    new Promise<Response>((done) => {
      resolve = done;
    }),
  );
  const { container, rerender } = render(<ShortcutIcon key={link.url} link={link} />);
  fireEvent.error(container.querySelector("img")!);
  const options = vi.mocked(fetch).mock.calls[0]![1]!;
  const changed = { ...link, url: "https://react.dev/" };
  rerender(<ShortcutIcon key={changed.url} link={changed} />);
  expect(options.signal!.aborted).toBe(true);
  await act(async () => resolve({ status: 202 } as Response));
  expect(vi.getTimerCount()).toBe(0);
  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    expect.stringContaining("react.dev"),
  );
});
