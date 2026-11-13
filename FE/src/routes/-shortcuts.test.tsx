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

it("기존 잘못된 URL이 접힌 분류에 있어도 다른 항목을 표시하고 수정할 수 있다", async () => {
  const saved = structuredClone(initial);
  saved.groups[0]!.links.push({ id: "invalid", name: "오류 주소", url: "http://4294967296/" });
  saved.groups[0]!.collapsed = true;
  vi.mocked(api.shortcuts.get).mockResolvedValue(saved);
  vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => ({
    ...input,
    revision: input.revision + 1,
  }));
  setup();
  await screen.findByRole("button", { name: "개발 3" });
  fireEvent.click(screen.getByRole("button", { name: "개발 3" }));
  await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
  expect(screen.queryByRole("link", { name: "오류 주소 새 탭에서 열기" })).not.toBeInTheDocument();
  expect(screen.getByText("잘못된 주소 · 정리에서 수정하세요.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "정리" }));
  fireEvent.click(screen.getByRole("button", { name: "오류 주소 바로가기 수정" }));
  fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://example.com/" } });
  fireEvent.click(screen.getByRole("button", { name: "완료" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByRole("link", { name: "오류 주소 새 탭에서 열기" })).toHaveAttribute(
    "href",
    "https://example.com/",
  );
});

it.each(["link", "group", "empty-link"])(
  "추가 응답 유실 후 재시도해도 같은 ID로 이미 저장된 작업을 확인한다 %s",
  async (kind) => {
    let persisted: ShortcutBoard =
      kind === "empty-link" ? { revision: 4, groups: [] } : structuredClone(initial);
    vi.mocked(api.shortcuts.get).mockImplementation(async () => structuredClone(persisted));
    let calls = 0;
    const save = vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
      calls++;
      if (calls === 1) {
        persisted = { ...structuredClone(input), revision: input.revision + 1 };
        throw new ApiError("응답 유실", "NETWORK");
      }
      if (input.revision !== persisted.revision)
        throw new ApiError("다른 곳에서 변경됐습니다.", "CONFLICT");
      persisted = { ...structuredClone(input), revision: input.revision + 1 };
      return persisted;
    });
    setup();
    const button = screen.getByRole("button", { name: kind === "group" ? "분류 추가" : "추가" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const modal = screen.getByRole("dialog");
    fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "한 번만 추가" } });
    if (kind !== "group")
      fireEvent.change(within(modal).getByLabelText("URL"), {
        target: { value: "https://example.com/new" },
      });
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    expect(await within(modal).findByRole("alert")).toHaveTextContent("응답 유실");
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    await waitFor(() => expect(within(modal).getByRole("alert")).toHaveTextContent("다른 곳"));
    await waitFor(() => expect(api.shortcuts.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(modal).getByRole("button", { name: "완료" })).toBeEnabled());
    const ids = (value: ShortcutBoard) =>
      kind === "group"
        ? value.groups.filter((group) => group.name === "한 번만 추가").map((group) => group.id)
        : value.groups
            .flatMap((group) => group.links)
            .filter((link) => link.name === "한 번만 추가")
            .map((link) => link.id);
    expect(ids(save.mock.calls[0]![0])).toEqual(ids(save.mock.calls[1]![0]));
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(save).toHaveBeenCalledTimes(2);
    expect(ids(persisted)).toHaveLength(1);
  },
);

it("응답 유실 후 입력을 수정해 다시 저장해도 원래 추가 ID를 갱신한다", async () => {
  let persisted = structuredClone(initial);
  vi.mocked(api.shortcuts.get).mockImplementation(async () => structuredClone(persisted));
  let calls = 0;
  const save = vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
    calls++;
    if (calls === 1) {
      persisted = { ...structuredClone(input), revision: input.revision + 1 };
      throw new ApiError("응답 유실", "NETWORK");
    }
    if (input.revision !== persisted.revision)
      throw new ApiError("다른 곳에서 변경됐습니다.", "CONFLICT");
    persisted = { ...structuredClone(input), revision: input.revision + 1 };
    return persisted;
  });
  setup();
  await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  const modal = screen.getByRole("dialog");
  fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "최초 이름" } });
  fireEvent.change(within(modal).getByLabelText("URL"), {
    target: { value: "https://example.com/" },
  });
  fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
  await within(modal).findByRole("alert");
  fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
  await waitFor(() => expect(api.shortcuts.get).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(within(modal).getByRole("button", { name: "완료" })).toBeEnabled());
  fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "수정 이름" } });
  fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
  await screen.findByRole("link", { name: "수정 이름 새 탭에서 열기" });
  expect(persisted.groups[0]!.links).toHaveLength(3);
  expect(persisted.groups[0]!.links[2]!.id).toBe(save.mock.calls[0]![0].groups[0]!.links[2]!.id);
});

it.each(["link", "group"])(
  "이미 저장된 추가 작업의 재시도가 이후 서버 변경을 덮어쓰지 않는다 %s",
  async (kind) => {
    let persisted = structuredClone(initial);
    vi.mocked(api.shortcuts.get).mockImplementation(async () => structuredClone(persisted));
    let calls = 0;
    const save = vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
      calls++;
      if (calls === 1) {
        persisted = { ...structuredClone(input), revision: input.revision + 2 };
        if (kind === "link") {
          const link = persisted.groups[0]!.links.pop()!;
          persisted.groups.push({
            id: "moved",
            name: "서버 분류",
            collapsed: false,
            links: [{ ...link, name: "서버 수정", url: "https://example.com/remote" }],
          });
        } else persisted.groups[persisted.groups.length - 1]!.name = "서버 수정";
        throw new ApiError("응답 유실", "NETWORK");
      }
      if (input.revision !== persisted.revision)
        throw new ApiError("다른 곳에서 변경됐습니다.", "CONFLICT");
      persisted = { ...structuredClone(input), revision: input.revision + 1 };
      return persisted;
    });
    setup();
    await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
    fireEvent.click(screen.getByRole("button", { name: kind === "group" ? "분류 추가" : "추가" }));
    const modal = screen.getByRole("dialog");
    fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "최초 이름" } });
    if (kind === "link")
      fireEvent.change(within(modal).getByLabelText("URL"), {
        target: { value: "https://example.com/" },
      });
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    await within(modal).findByRole("alert");
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    await waitFor(() => expect(api.shortcuts.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("서버 수정")).toBeInTheDocument());
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(save).toHaveBeenCalledTimes(2);
    expect(persisted.revision).toBe(6);
    if (kind === "link")
      expect(persisted.groups[1]!.links[0]).toMatchObject({
        name: "서버 수정",
        url: "https://example.com/remote",
      });
    else expect(persisted.groups[1]!.name).toBe("서버 수정");
  },
);
