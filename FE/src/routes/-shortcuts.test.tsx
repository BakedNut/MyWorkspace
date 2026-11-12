import type { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "@/api";
import type { ShortcutBoard } from "@/types/domain";
import { Route } from "./shortcuts";

const Page = Route.options.component as ComponentType;
const initial: ShortcutBoard = {
  revision: 4,
  groups: [
    {
      id: "dev",
      name: "개발",
      collapsed: false,
      links: [
        { id: "github", name: "GitHub", url: "https://github.com/" },
        { id: "react", name: "React", url: "https://react.dev/" },
      ],
    },
  ],
};
beforeEach(() => {
  vi.spyOn(api.shortcuts, "get").mockResolvedValue(structuredClone(initial));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Page />
    </QueryClientProvider>,
  );
}

it("분류를 접고 서버에 저장하며, 링크는 안전한 새 탭으로 연다", async () => {
  const save = vi
    .spyOn(api.shortcuts, "save")
    .mockImplementation(async (input) => ({ ...input, revision: input.revision + 1 }));
  setup();
  const link = await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  fireEvent.click(screen.getByRole("button", { name: "개발 2" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]?.[0].groups[0]?.collapsed).toBe(true);
  await waitFor(() =>
    expect(screen.queryByRole("link", { name: "GitHub 새 탭에서 열기" })).not.toBeInTheDocument(),
  );
});

it("추가 실패에도 이름·URL을 보존하고 재시도한다", async () => {
  const save = vi
    .spyOn(api.shortcuts, "save")
    .mockRejectedValueOnce(new ApiError("저장 실패", "NETWORK"))
    .mockImplementation(async (input) => ({ ...input, revision: input.revision + 1 }));
  setup();
  await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
  fireEvent.click(await screen.findByRole("button", { name: "추가" }));
  const modal = screen.getByRole("dialog", { name: "바로가기 추가" });
  fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "문서" } });
  fireEvent.change(within(modal).getByLabelText("URL"), { target: { value: "example.com/docs" } });
  fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
  expect(await within(modal).findByRole("alert")).toHaveTextContent("저장 실패");
  expect(within(modal).getByLabelText("이름")).toHaveValue("문서");
  expect(within(modal).getByLabelText("URL")).toHaveValue("example.com/docs");
  fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
  expect(await screen.findByRole("link", { name: "문서 새 탭에서 열기" })).toHaveAttribute(
    "href",
    "https://example.com/docs",
  );
  expect(save).toHaveBeenCalledTimes(2);
});

it("정리 취소는 서버에 쓰지 않고 수정 저장은 기존 순서를 보존한다", async () => {
  const save = vi
    .spyOn(api.shortcuts, "save")
    .mockImplementation(async (input) => ({ ...input, revision: input.revision + 1 }));
  setup();
  await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
  fireEvent.click(await screen.findByRole("button", { name: "정리" }));
  fireEvent.click(screen.getByRole("button", { name: "GitHub 바로가기 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" })).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "정리" }));
  fireEvent.click(screen.getByRole("button", { name: "GitHub 바로가기 수정" }));
  const modal = screen.getByRole("dialog");
  fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "코드" } });
  fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByRole("link", { name: "코드 새 탭에서 열기" });
  expect(save.mock.calls[0]?.[0].groups[0]?.links.map((link) => link.id)).toEqual([
    "github",
    "react",
  ]);
});
