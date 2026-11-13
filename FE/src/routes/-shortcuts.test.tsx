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

it("동시 편집 충돌 후 초안과 최신 변경을 합쳐 최신 revision으로 다시 저장한다", async () => {
  const latest = structuredClone(initial);
  latest.revision = 5;
  latest.groups[0]!.links[1]!.name = "React 최신";
  latest.groups[0]!.links.push({ id: "new", name: "새 링크", url: "https://example.com/" });
  const get = vi.mocked(api.shortcuts.get);
  get.mockResolvedValueOnce(structuredClone(initial)).mockResolvedValue(latest);
  const save = vi
    .spyOn(api.shortcuts, "save")
    .mockRejectedValueOnce(new ApiError("다른 곳에서 변경됐습니다.", "CONFLICT"))
    .mockImplementation(async (input) => ({ ...input, revision: input.revision + 1 }));
  setup();
  await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
  fireEvent.click(screen.getByRole("button", { name: "정리" }));
  fireEvent.click(screen.getByRole("button", { name: "GitHub 바로가기 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  fireEvent.click(await screen.findByRole("button", { name: "최신 변경과 합치기" }));
  await screen.findByRole("button", { name: "React 최신 바로가기 수정" });
  expect(screen.queryByRole("button", { name: "GitHub 바로가기 수정" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "새 링크 바로가기 수정" })).toBeInTheDocument();
  expect(save).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByRole("link", { name: "새 링크 새 탭에서 열기" });
  expect(save.mock.calls[1]![0].revision).toBe(5);
  expect(save.mock.calls[1]![0].groups[0]!.links.map((link) => link.id)).toEqual(["react", "new"]);
});

it("추가 모달을 취소하거나 Escape로 닫으면 실행 버튼으로 포커스를 복원한다", async () => {
  setup();
  await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
  const trigger = screen.getByRole("button", { name: "추가" });
  fireEvent.click(trigger);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "취소" }));
  await waitFor(() => expect(trigger).toHaveFocus());
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("수정 완료 시 실행 버튼으로, 분류 삭제 시 대체 버튼으로 포커스를 복원한다", async () => {
  setup();
  await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
  fireEvent.click(screen.getByRole("button", { name: "정리" }));
  const trigger = screen.getByRole("button", { name: "GitHub 바로가기 수정" });
  fireEvent.click(trigger);
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "코드" } });
  fireEvent.click(screen.getByRole("button", { name: "완료" }));
  await waitFor(() => expect(trigger).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "개발 분류 삭제" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "분류 추가" })).toHaveFocus());
});

it("추가 도중 선택한 분류가 삭제돼도 이름·URL을 유지하고 남은 분류로 저장한다", async () => {
  const original = {
    ...structuredClone(initial),
    groups: [
      ...structuredClone(initial.groups),
      { id: "remaining", name: "남은 분류", collapsed: false, links: [] },
    ],
  };
  const latest: ShortcutBoard = { revision: 5, groups: [original.groups[1]!] };
  vi.mocked(api.shortcuts.get).mockResolvedValueOnce(original).mockResolvedValue(latest);
  const save = vi
    .spyOn(api.shortcuts, "save")
    .mockRejectedValueOnce(new ApiError("다른 곳에서 변경됐습니다.", "CONFLICT"))
    .mockImplementation(async (input) => ({ ...input, revision: input.revision + 1 }));
  setup();
  await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  const modal = screen.getByRole("dialog");
  fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "입력 보존" } });
  fireEvent.change(within(modal).getByLabelText("URL"), {
    target: { value: "https://example.com/" },
  });
  fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
  await within(modal).findByRole("alert");
  await waitFor(() => expect(within(modal).getByLabelText("분류")).toHaveValue("remaining"));
  expect(within(modal).getByLabelText("이름")).toHaveValue("입력 보존");
  expect(within(modal).getByLabelText("URL")).toHaveValue("https://example.com/");
  fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
  await screen.findByRole("link", { name: "입력 보존 새 탭에서 열기" });
  expect(save.mock.calls[1]![0].revision).toBe(5);
  expect(save.mock.calls[1]![0].groups[0]!.id).toBe("remaining");
});
