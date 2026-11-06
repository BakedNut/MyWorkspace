import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { SecurityDialog } from "./SecurityDialog";

vi.mock("@/api", async () => ({ ...(await vi.importActual("@/api")), isPreview: false }));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,fixture") },
}));
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
function setup(otpEnabled = false, requiresHttps = false) {
  vi.spyOn(api.security, "getStatus").mockResolvedValue({
    otpEnabled,
    passwordChanged: false,
    requiresHttps,
    secureSetupUrl: "https://example.com/",
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SecurityDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}
it("HTTP에서는 비밀번호 입력을 받지 않고 HTTPS로 안내한다", async () => {
  setup(false, true);
  expect(await screen.findByRole("link", { name: "HTTPS에서 설정" })).toHaveAttribute(
    "href",
    "https://example.com/",
  );
  expect(screen.queryByLabelText("새 비밀번호", { exact: true })).toBeNull();
});
it("기존 비밀번호와 OTP 중 하나를 선택해 변경한다", async () => {
  const change = vi.spyOn(api.security, "changePassword").mockResolvedValue();
  setup(true);
  fireEvent.change(
    await screen.findByLabelText("기존 비밀번호", { selector: "input[type=password]" }),
    { target: { value: "old-password" } },
  );
  fireEvent.change(screen.getByLabelText("새 비밀번호", { exact: true }), {
    target: { value: "new-password-long" },
  });
  fireEvent.change(screen.getByLabelText("새 비밀번호 확인"), {
    target: { value: "different-value" },
  });
  fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("일치하지");
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("새 비밀번호 확인"), {
    target: { value: "new-password-long" },
  });
  fireEvent.click(screen.getByRole("radio", { name: "Google OTP" }));
  fireEvent.change(screen.getByLabelText("OTP 인증번호"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경 저장" }));
  await waitFor(() => expect(change).toHaveBeenCalledOnce());
  expect(change).toHaveBeenCalledWith({
    method: "otp",
    otp: "123456",
    newPassword: "new-password-long",
    confirmPassword: "new-password-long",
  });
  await screen.findByText(/비밀번호를 변경했습니다/);
  expect(screen.getByLabelText("새 비밀번호", { exact: true })).toHaveValue("");
  expect(localStorage.length).toBe(0);
});
it("OTP는 기존 암호와 첫 인증번호를 확인한 뒤 등록한다", async () => {
  const begin = vi.spyOn(api.security, "beginOtp").mockResolvedValue({
    secret: "JBSWY3DPEHPK3PXP",
    setupToken: "fixture-token",
    uri: "otpauth://totp/MyWorkspace?secret=JBSWY3DPEHPK3PXP",
  });
  const confirm = vi.spyOn(api.security, "confirmOtp").mockResolvedValue();
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Google OTP" }));
  fireEvent.change(screen.getByLabelText("기존 비밀번호", { exact: true }), {
    target: { value: "old-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Google OTP 등록" }));
  await screen.findByAltText("Google OTP 등록 QR");
  expect(begin).toHaveBeenCalledWith("old-password");
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("앱의 인증번호"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "OTP 등록 확인" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith("fixture-token", "123456"));
  expect(localStorage.length).toBe(0);
});
