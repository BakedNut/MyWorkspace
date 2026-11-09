import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { ICloudDialog } from "./ICloudDialog";
import type { ICloudStatus } from "@/types/domain";

vi.mock("@/api", async () => ({ ...(await vi.importActual("@/api")), isPreview: false }));
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const disconnected: ICloudStatus = {
  mode: "live",
  state: "disconnected",
  lastSyncedAt: null,
  requiresHttps: false,
};
const connected: ICloudStatus = {
  mode: "live",
  state: "connected",
  lastSyncedAt: "2026-11-06T10:00:00Z",
  calendarName: "개인",
  accountLabel: "te***@example.com",
  requiresHttps: false,
};
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ICloudDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

it("HTTP에서는 계정 입력 대신 HTTPS 연결을 안내한다", async () => {
  vi.spyOn(api.calendar, "getICloudStatus").mockResolvedValue({
    ...disconnected,
    requiresHttps: true,
    secureSetupUrl: "https://example.com/calendar",
  });
  setup();
  expect(await screen.findByRole("link", { name: "HTTPS에서 연결" })).toHaveAttribute(
    "href",
    "https://example.com/calendar",
  );
  expect(screen.queryByLabelText("앱 전용 암호")).toBeNull();
});

it("계정 확인 후 선택한 캘린더를 연결하고 해제 확인을 거친다", async () => {
  const status = vi
    .spyOn(api.calendar, "getICloudStatus")
    .mockResolvedValueOnce(disconnected)
    .mockResolvedValue(connected);
  const discover = vi.spyOn(api.calendar, "discoverICloud").mockResolvedValue({
    draftToken: "draft",
    calendars: [{ id: "home", name: "개인", readOnly: false }],
  });
  const connect = vi.spyOn(api.calendar, "connectICloud").mockResolvedValue(connected);
  const disconnect = vi.spyOn(api.calendar, "disconnectICloud").mockResolvedValue();
  setup();
  fireEvent.change(await screen.findByLabelText("Apple ID"), {
    target: { value: "test@example.com" },
  });
  fireEvent.change(screen.getByLabelText("앱 전용 암호"), {
    target: { value: "abcd-efgh-ijkl-mnop" },
  });
  fireEvent.click(screen.getByRole("button", { name: "캘린더 목록 확인" }));
  await screen.findByLabelText("연결할 캘린더");
  expect(discover).toHaveBeenCalledWith({
    appleId: "test@example.com",
    appPassword: "abcd-efgh-ijkl-mnop",
  });
  expect(screen.queryByLabelText("앱 전용 암호")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "선택한 캘린더 연결" }));
  await screen.findByText("연결됨", { exact: true });
  expect(connect).toHaveBeenCalledWith("draft", "home");
  expect(localStorage.length).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "연결 해제" }));
  expect(disconnect).not.toHaveBeenCalled();
  status.mockResolvedValue(disconnected);
  fireEvent.click(screen.getByRole("button", { name: "연결 해제 확인" }));
  await waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
  expect(await screen.findByLabelText("앱 전용 암호")).toHaveValue("");
});

it("인증 실패를 표시하고 암호는 지우며 Apple ID는 유지한다", async () => {
  vi.spyOn(api.calendar, "getICloudStatus").mockResolvedValue(disconnected);
  vi.spyOn(api.calendar, "discoverICloud").mockRejectedValue(
    new Error("앱 전용 암호를 확인하세요."),
  );
  setup();
  fireEvent.change(await screen.findByLabelText("Apple ID"), {
    target: { value: "test@example.com" },
  });
  fireEvent.change(screen.getByLabelText("앱 전용 암호"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "캘린더 목록 확인" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("앱 전용 암호를 확인하세요.");
  expect(screen.getByLabelText("앱 전용 암호")).toHaveValue("");
  expect(screen.getByLabelText("Apple ID")).toHaveValue("test@example.com");
});
