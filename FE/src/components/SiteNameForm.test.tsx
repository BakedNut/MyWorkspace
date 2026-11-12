import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "@/api";
import { useSiteName } from "@/lib/site";
import { SiteNameForm } from "./SiteNameForm";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api.site, "get").mockResolvedValue({ siteName: "MyWorkspace" });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function NamePreview() {
  return <p data-testid="site-preview">{useSiteName()}</p>;
}
function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SiteNameForm />
      <NamePreview />
    </QueryClientProvider>,
  );
}
it("이름을 서버에 저장하고 같은 화면의 표시도 즉시 갱신한다", async () => {
  const save = vi.spyOn(api.site, "save").mockResolvedValue({ siteName: "나의 공간" });
  setup();
  fireEvent.change(await screen.findByLabelText("사이트 이름"), {
    target: { value: "  나의 공간  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "사이트 이름 저장" }));
  expect(await screen.findByText("사이트 이름을 저장했습니다.")).toBeInTheDocument();
  expect(save).toHaveBeenCalledExactlyOnceWith({ siteName: "나의 공간" });
  expect(screen.getByTestId("site-preview")).toHaveTextContent("나의 공간");
  expect(screen.getByLabelText("사이트 이름")).toHaveValue("나의 공간");
  expect(localStorage.length).toBe(0);
});
it("저장 실패 시 입력과 원래 사이트 이름을 유지한다", async () => {
  vi.spyOn(api.site, "save").mockRejectedValue(new ApiError("저장 실패", "NETWORK"));
  setup();
  fireEvent.change(await screen.findByLabelText("사이트 이름"), { target: { value: "입력 보존" } });
  fireEvent.click(screen.getByRole("button", { name: "사이트 이름 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("저장 실패");
  expect(screen.getByLabelText("사이트 이름")).toHaveValue("입력 보존");
  expect(screen.getByTestId("site-preview")).toHaveTextContent("MyWorkspace");
});
it("공백만 있는 이름을 저장하지 않는다", async () => {
  const save = vi.spyOn(api.site, "save");
  setup();
  fireEvent.change(await screen.findByLabelText("사이트 이름"), { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "사이트 이름 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("1~40자");
  expect(save).not.toHaveBeenCalled();
});
