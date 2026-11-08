import type { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "@/api";
import { Route } from "./wol";

const Page = Route.options.component as ComponentType;

beforeEach(() => {
  vi.spyOn(api.wol, "list").mockResolvedValue([
    { id: "test", name: "테스트 PC", mac: "02:12:34:56:78:9A" },
  ]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Page />
    </QueryClientProvider>,
  );
}

it("전송 직후 결과를 표시하고 부팅 조회 없이 10초 후 다시 요청할 수 있다", async () => {
  const wake = vi.spyOn(api.wol, "wake").mockResolvedValue({ sentAt: new Date().toISOString() });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.useFakeTimers();
  setup();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  const button = screen.getByRole("button", { name: "테스트 PC 깨우기" });
  await act(async () => fireEvent.click(button));
  expect(screen.getByText(/매직 패킷 전송 완료/)).toBeInTheDocument();
  expect(button).toBeDisabled();
  await act(async () => vi.advanceTimersByTimeAsync(9_000));
  expect(button).toBeDisabled();
  expect(screen.queryByText(/부팅|응답 없음/)).not.toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(1_250));
  expect(button).toBeEnabled();
  expect(wake).toHaveBeenCalledExactlyOnceWith("test");
  expect(fetch).not.toHaveBeenCalled();
});

it("전송 실패는 오류로 표시하고 성공 메시지를 보여주지 않는다", async () => {
  vi.spyOn(api.wol, "wake").mockRejectedValue(new ApiError("패킷 전송 실패", "NETWORK"));
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "테스트 PC 깨우기" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("패킷 전송 실패");
  expect(screen.queryByText(/매직 패킷 전송 완료/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "테스트 PC 깨우기" })).toBeEnabled();
});
