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
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.shortcuts.get).toHaveBeenCalledTimes(2);
    const ids = (value: ShortcutBoard) =>
      kind === "group"
        ? value.groups.filter((group) => group.name === "한 번만 추가").map((group) => group.id)
        : value.groups
            .flatMap((group) => group.links)
            .filter((link) => link.name === "한 번만 추가")
            .map((link) => link.id);
    expect(ids(save.mock.calls[0]![0])).toEqual(ids(save.mock.calls[1]![0]));
    expect(save.mock.calls[1]![0]).toEqual(save.mock.calls[0]![0]);
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

it.each(["automatic", "initial-manual", "manual-after-loss", "manual-target-removed"])(
  "추가 재시도에서 자동 대체 분류와 사용자 선택을 구분한다 %s",
  async (mode) => {
    const original = structuredClone(initial);
    original.groups.push(
      { id: "b", name: "분류 B", collapsed: false, links: [] },
      { id: "c", name: "분류 C", collapsed: false, links: [] },
    );
    if (mode === "manual-target-removed")
      original.groups.splice(2, 0, { id: "d", name: "분류 D", collapsed: false, links: [] });
    if (mode === "initial-manual")
      [original.groups[0], original.groups[1]] = [original.groups[1]!, original.groups[0]!];
    let persisted = structuredClone(original);
    vi.mocked(api.shortcuts.get).mockImplementation(async () => structuredClone(persisted));
    let calls = 0;
    const save = vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
      calls++;
      if (calls === 1) {
        const added = input.groups
          .flatMap((group) => group.links)
          .find((link) => link.name === "추가 확인")!;
        persisted = {
          revision: input.revision + 2,
          groups: input.groups
            .filter(
              (group) =>
                group.id !== "dev" && (mode !== "manual-target-removed" || group.id !== "b"),
            )
            .map((group) =>
              group.id === "c" ? { ...group, links: [{ ...added, name: "서버 수정" }] } : group,
            ),
        };
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
    fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "추가 확인" } });
    fireEvent.change(within(modal).getByLabelText("URL"), {
      target: { value: "https://example.com/" },
    });
    if (mode === "initial-manual")
      fireEvent.change(within(modal).getByLabelText("분류"), { target: { value: "dev" } });
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    await within(modal).findByRole("alert");
    if (mode === "manual-target-removed" || mode === "manual-after-loss")
      fireEvent.change(within(modal).getByLabelText("분류"), { target: { value: "b" } });
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    if (mode === "manual-target-removed") {
      await waitFor(() => expect(within(modal).getByLabelText("분류")).toHaveValue("c"));
      fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(save).toHaveBeenCalledTimes(mode === "manual-after-loss" ? 3 : 2);
    const destination = mode === "manual-after-loss" ? "b" : "c";
    expect(persisted.groups.find((group) => group.id === destination)!.links[0]!.name).toBe(
      "서버 수정",
    );
  },
);

it("링크를 개별 삭제한 뒤 원래 분류도 삭제하면 충돌 후 링크를 복원하지 않는다", async () => {
  const original = structuredClone(initial);
  original.groups[0]!.links = [original.groups[0]!.links[0]!];
  original.groups.push({ id: "b", name: "분류 B", collapsed: false, links: [] });
  const latest = structuredClone(original);
  latest.revision++;
  latest.groups[1]!.links = latest.groups[0]!.links;
  latest.groups[0]!.links = [];
  vi.mocked(api.shortcuts.get).mockResolvedValueOnce(original).mockResolvedValue(latest);
  const save = vi
    .spyOn(api.shortcuts, "save")
    .mockRejectedValueOnce(new ApiError("다른 곳", "CONFLICT"))
    .mockImplementation(async (input) => ({ ...input, revision: input.revision + 1 }));
  setup();
  await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
  fireEvent.click(screen.getByRole("button", { name: "정리" }));
  fireEvent.click(screen.getByRole("button", { name: "GitHub 바로가기 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "개발 분류 삭제" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  fireEvent.click(await screen.findByRole("button", { name: "최신 변경과 합치기" }));
  await screen.findByRole("button", { name: "저장" });
  expect(screen.queryByRole("button", { name: "GitHub 바로가기 수정" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByRole("button", { name: "정리" });
  expect(save.mock.calls[1]![0].groups.flatMap((group) => group.links)).toEqual([]);
});

it("기존 오류 URL을 유지하며 이름과 분류를 바꾸고 새 오류 URL은 거부한다", async () => {
  const original = structuredClone(initial);
  original.groups[0]!.links = [{ id: "legacy", name: "기존 오류", url: "http://4294967296/" }];
  original.groups.push({ id: "b", name: "분류 B", collapsed: false, links: [] });
  vi.mocked(api.shortcuts.get).mockResolvedValue(original);
  const save = vi
    .spyOn(api.shortcuts, "save")
    .mockImplementation(async (input) => ({ ...input, revision: input.revision + 1 }));
  setup();
  await screen.findByText("기존 오류");
  fireEvent.click(screen.getByRole("button", { name: "정리" }));
  fireEvent.click(screen.getByRole("button", { name: "기존 오류 바로가기 수정" }));
  const modal = screen.getByRole("dialog");
  fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "이름 수정" } });
  fireEvent.change(within(modal).getByLabelText("분류"), { target: { value: "b" } });
  fireEvent.change(within(modal).getByLabelText("URL"), {
    target: { value: "http://4294967297/" },
  });
  fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
  await within(modal).findByRole("alert");
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(within(modal).getByLabelText("URL"), {
    target: { value: "http://4294967296/" },
  });
  fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByRole("button", { name: "정리" });
  expect(save.mock.calls[0]![0].groups[1]!.links[0]).toEqual({
    id: "legacy",
    name: "이름 수정",
    url: "http://4294967296/",
  });
});

it("빈 화면도 저장 중 추가를 비활성화해 새 초안의 유실을 방지한다", async () => {
  let release: (() => void) | undefined;
  vi.spyOn(api.shortcuts, "save").mockImplementation(
    (input) =>
      new Promise((resolve) => {
        release = () => resolve({ ...input, revision: input.revision + 1 });
      }),
  );
  setup();
  await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
  fireEvent.click(screen.getByRole("button", { name: "정리" }));
  fireEvent.click(screen.getByRole("button", { name: "개발 분류 삭제" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  const add = screen.getByRole("button", { name: "바로가기 추가" });
  await waitFor(() => expect(add).toBeDisabled());
  fireEvent.click(add);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  release!();
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  expect(screen.getByRole("dialog", { name: "바로가기 추가" })).toBeInTheDocument();
});

it.each(["unchanged", "name", "group"])(
  "반복 충돌에서 자동 배치와 이후 직접 편집을 구분한다 %s",
  async (edit) => {
    const original: ShortcutBoard = {
      revision: 1,
      groups: ["a", "b", "c"].map((id) => ({ id, name: id, collapsed: false, links: [] })),
    };
    let persisted = structuredClone(original);
    vi.mocked(api.shortcuts.get).mockImplementation(async () => structuredClone(persisted));
    let calls = 0;
    const save = vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
      calls++;
      if (calls === 1) {
        persisted.groups[0]!.links.push({
          id: "x",
          name: "원격 추가",
          url: "https://example.com/x",
        });
        persisted.revision++;
      } else if (calls === 2) {
        persisted.groups[0]!.links = [];
        persisted.revision++;
      } else {
        persisted = { ...structuredClone(input), revision: input.revision + 1 };
        return persisted;
      }
      throw new ApiError("다른 곳에서 변경됐습니다.", "CONFLICT");
    });
    setup();
    await screen.findByRole("button", { name: "a 0" });
    fireEvent.click(screen.getByRole("button", { name: "정리" }));
    fireEvent.click(screen.getByRole("button", { name: "a 분류 삭제" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    fireEvent.click(await screen.findByRole("button", { name: "최신 변경과 합치기" }));
    await screen.findByRole("button", { name: "원격 추가 바로가기 수정" });
    if (edit !== "unchanged") {
      fireEvent.click(screen.getByRole("button", { name: "원격 추가 바로가기 수정" }));
      const modal = screen.getByRole("dialog");
      if (edit === "name")
        fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "직접 수정" } });
      else fireEvent.change(within(modal).getByLabelText("분류"), { target: { value: "c" } });
      fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    fireEvent.click(await screen.findByRole("button", { name: "최신 변경과 합치기" }));
    await screen.findByRole("button", { name: "저장" });
    const links = screen.queryAllByRole("button", { name: /바로가기 수정$/ });
    expect(links).toHaveLength(edit === "unchanged" ? 0 : 1);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("button", { name: "정리" });
    expect(save).toHaveBeenCalledTimes(3);
    expect(persisted.groups.map((group) => group.id)).toEqual(["b", "c"]);
    if (edit === "unchanged") expect(persisted.groups.flatMap((group) => group.links)).toEqual([]);
    else {
      const destination = persisted.groups.find(
        (group) => group.id === (edit === "group" ? "c" : "b"),
      )!;
      expect(destination.links[0]!.name).toBe(edit === "name" ? "직접 수정" : "원격 추가");
    }
  },
);

it.each(
  ["link-name", "link-url", "link-group", "group-name"].flatMap((field) =>
    [false, true].map((changedAfterLoss) => ({ field, changedAfterLoss })),
  ),
)(
  "각 추가 재시도의 제출값을 기준으로 서버 편집을 보존한다 $field / 직접 변경 $changedAfterLoss",
  async ({ field, changedAfterLoss }) => {
    const isGroup = field === "group-name";
    const original = structuredClone(initial);
    original.groups.push(
      ...["b", "c", "d"].map((id) => ({ id, name: id, collapsed: false, links: [] })),
    );
    let persisted = structuredClone(original);
    vi.mocked(api.shortcuts.get).mockImplementation(async () => structuredClone(persisted));
    let calls = 0;
    let id = "";
    let lostSave = false;
    const save = vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
      calls++;
      const added = isGroup
        ? input.groups.find((group) => !original.groups.some((item) => item.id === group.id))!
        : input.groups
            .flatMap((group) => group.links)
            .find((link) => !["github", "react"].includes(link.id))!;
      if (calls === 1) {
        id = added.id;
        throw new ApiError("전송 실패", "NETWORK");
      }
      expect(added.id).toBe(id);
      if (input.revision !== persisted.revision) throw new ApiError("다른 곳", "CONFLICT");
      const submittedB =
        isGroup || field === "link-name"
          ? added.name === "B"
          : field === "link-url"
            ? "url" in added && added.url === "https://example.com/B"
            : input.groups.find((group) => group.id === "b")!.links.some((link) => link.id === id);
      if (!lostSave && submittedB) {
        lostSave = true;
        persisted = { ...structuredClone(input), revision: input.revision + 2 };
        if (isGroup) persisted.groups.find((group) => group.id === id)!.name = "C";
        else {
          const source = persisted.groups.find((group) =>
            group.links.some((link) => link.id === id),
          )!;
          const link = source.links.find((link) => link.id === id)!;
          if (field === "link-name") link.name = "C";
          if (field === "link-url") link.url = "https://example.com/C";
          if (field === "link-group") {
            source.links = source.links.filter((item) => item.id !== id);
            persisted.groups.find((group) => group.id === "c")!.links.push(link);
          }
        }
        throw new ApiError("응답 유실", "NETWORK");
      }
      persisted = { ...structuredClone(input), revision: input.revision + 1 };
      return persisted;
    });
    setup();
    await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
    fireEvent.click(screen.getByRole("button", { name: isGroup ? "분류 추가" : "추가" }));
    const modal = screen.getByRole("dialog");
    fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "A" } });
    if (!isGroup)
      fireEvent.change(within(modal).getByLabelText("URL"), {
        target: { value: "https://example.com/A" },
      });
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    expect(await within(modal).findByRole("alert")).toHaveTextContent("전송 실패");
    const changeField = (value: string) => {
      const label = field === "link-url" ? "URL" : field === "link-group" ? "분류" : "이름";
      const input =
        field === "link-url"
          ? `https://example.com/${value}`
          : field === "link-group"
            ? value.toLowerCase()
            : value;
      fireEvent.change(within(modal).getByLabelText(label), { target: { value: input } });
    };
    changeField("B");
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    expect(await within(modal).findByRole("alert")).toHaveTextContent("응답 유실");
    if (changedAfterLoss) changeField("D");
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.shortcuts.get).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(changedAfterLoss ? 5 : 4);
    const expected = changedAfterLoss ? "D" : "C";
    if (isGroup) expect(persisted.groups.find((group) => group.id === id)!.name).toBe(expected);
    else {
      const destination = persisted.groups.find((group) =>
        group.links.some((link) => link.id === id),
      )!;
      const added = destination.links.find((link) => link.id === id)!;
      if (field === "link-name") expect(added.name).toBe(expected);
      if (field === "link-url") expect(added.url).toBe(`https://example.com/${expected}`);
      if (field === "link-group") expect(destination.id).toBe(expected.toLowerCase());
    }
  },
);

it.each(["link-name", "link-url", "link-group", "group-name"])(
  "같은 리비전의 불확실한 요청을 확인한 뒤 새 입력을 저장한다 %s",
  async (field) => {
    const isGroup = field === "group-name";
    const original = structuredClone(initial);
    original.groups.push({ id: "b", name: "B", collapsed: false, links: [] });
    let persisted = structuredClone(original);
    vi.mocked(api.shortcuts.get).mockImplementation(async () => structuredClone(persisted));
    let calls = 0;
    const save = vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
      calls++;
      if (calls === 2) throw new ApiError("다시 전송 실패", "NETWORK");
      if (input.revision !== persisted.revision) throw new ApiError("다른 곳", "CONFLICT");
      persisted = { ...structuredClone(input), revision: input.revision + 1 };
      if (calls === 1) throw new ApiError("응답 유실", "NETWORK");
      return persisted;
    });
    setup();
    await screen.findByRole("link", { name: "GitHub 새 탭에서 열기" });
    fireEvent.click(screen.getByRole("button", { name: isGroup ? "분류 추가" : "추가" }));
    const modal = screen.getByRole("dialog");
    fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "A" } });
    if (!isGroup)
      fireEvent.change(within(modal).getByLabelText("URL"), {
        target: { value: "https://example.com/A" },
      });
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    expect(await within(modal).findByRole("alert")).toHaveTextContent("응답 유실");
    const label = field === "link-url" ? "URL" : field === "link-group" ? "분류" : "이름";
    const value =
      field === "link-url" ? "https://example.com/B" : field === "link-group" ? "b" : "B";
    fireEvent.change(within(modal).getByLabelText(label), { target: { value } });
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    expect(await within(modal).findByRole("alert")).toHaveTextContent("다시 전송 실패");
    for (let retry = 0; retry < 3 && screen.queryByRole("dialog"); retry++) {
      fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog") === null ||
            !within(modal).getByRole("button", { name: "완료" }).hasAttribute("disabled"),
        ).toBe(true),
      );
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    if (isGroup) expect(persisted.groups.at(-1)!.name).toBe("B");
    else {
      const group = persisted.groups.find((item) =>
        item.links.some((link) => !["github", "react"].includes(link.id)),
      )!;
      const link = group.links.find((item) => !["github", "react"].includes(item.id))!;
      if (field === "link-name") expect(link.name).toBe("B");
      if (field === "link-url") expect(link.url).toBe("https://example.com/B");
      if (field === "link-group") expect(group.id).toBe("b");
    }
    expect(save).toHaveBeenCalledTimes(4);
  },
);

it.each(["automatic", "initial-manual", "explicit-final"])(
  "자동 표시한 분류가 연속 응답 유실 후에도 사용자 선택으로 바뀌지 않는다 %s",
  async (mode) => {
    const original: ShortcutBoard = {
      revision: 1,
      groups: ["a", "b", "c", "d"].map((id) => ({ id, name: id, collapsed: false, links: [] })),
    };
    if (mode === "initial-manual")
      [original.groups[0], original.groups[1]] = [original.groups[1]!, original.groups[0]!];
    let persisted = structuredClone(original);
    vi.mocked(api.shortcuts.get).mockImplementation(async () => structuredClone(persisted));
    let losses = 0;
    vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
      if (input.revision !== persisted.revision) throw new ApiError("다른 곳", "CONFLICT");
      persisted = { ...structuredClone(input), revision: input.revision + 1 };
      if (losses < 2) {
        const source = persisted.groups.find((group) => group.links.length)!;
        const link = source.links[0]!;
        source.links = [];
        persisted.groups.find((group) => group.id === (losses === 0 ? "b" : "c"))!.links = [link];
        persisted.revision++;
        losses++;
        throw new ApiError(`응답 유실 ${losses}`, "NETWORK");
      }
      return persisted;
    });
    setup();
    await screen.findByRole("button", { name: "a 0" });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    const modal = screen.getByRole("dialog");
    fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "처음 이름" } });
    fireEvent.change(within(modal).getByLabelText("URL"), {
      target: { value: "https://example.com/" },
    });
    if (mode === "initial-manual")
      fireEvent.change(within(modal).getByLabelText("분류"), { target: { value: "a" } });
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    expect(await within(modal).findByRole("alert")).toHaveTextContent("응답 유실 1");
    fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "이름만 수정" } });
    for (let retry = 0; retry < 3 && losses < 2; retry++) {
      fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
      await waitFor(() =>
        expect(within(modal).getByRole("button", { name: "완료" })).toBeEnabled(),
      );
    }
    expect(losses).toBe(2);
    expect(within(modal).getByRole("alert")).toHaveTextContent("응답 유실 2");
    if (mode === "explicit-final")
      fireEvent.change(within(modal).getByLabelText("분류"), { target: { value: "d" } });
    for (let retry = 0; retry < 3 && screen.queryByRole("dialog"); retry++) {
      fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog") === null ||
            !within(modal).getByRole("button", { name: "완료" }).hasAttribute("disabled"),
        ).toBe(true),
      );
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const destination = persisted.groups.find((group) => group.links.length)!;
    expect(destination.id).toBe(mode === "explicit-final" ? "d" : "c");
    expect(destination.links[0]!.name).toBe("이름만 수정");
  },
);

it("유일한 분류를 임시 복원한 뒤 링크가 원격 삭제돼도 분류 삭제 의도를 유지한다", async () => {
  const original: ShortcutBoard = {
    revision: 1,
    groups: [{ id: "a", name: "A", collapsed: false, links: [] }],
  };
  let persisted = structuredClone(original);
  vi.mocked(api.shortcuts.get).mockImplementation(async () => structuredClone(persisted));
  let calls = 0;
  vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
    calls++;
    if (calls < 3) {
      persisted.groups[0]!.links =
        calls === 1 ? [{ id: "x", name: "원격 추가", url: "https://example.com/" }] : [];
      persisted.revision++;
      throw new ApiError("다른 곳", "CONFLICT");
    }
    persisted = { ...structuredClone(input), revision: input.revision + 1 };
    return persisted;
  });
  setup();
  await screen.findByRole("button", { name: "A 0" });
  fireEvent.click(screen.getByRole("button", { name: "정리" }));
  fireEvent.click(screen.getByRole("button", { name: "A 분류 삭제" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  for (let round = 0; round < 2; round++) {
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    fireEvent.click(await screen.findByRole("button", { name: "최신 변경과 합치기" }));
    await screen.findByRole("button", { name: "저장" });
  }
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByRole("button", { name: "정리" });
  expect(persisted.groups).toEqual([]);
});

it.each([false, true])(
  "분류 임시 복원 후 원격 이동의 반복 충돌도 저장 전에 보존한다 %s",
  async (explicitDelete) => {
    const x = { id: "x", name: "X", url: "https://example.com/X" };
    const y = { id: "y", name: "Y", url: "https://example.com/Y" };
    const original: ShortcutBoard = {
      revision: 1,
      groups: [{ id: "a", name: "A", collapsed: false, links: [x] }],
    };
    let persisted = structuredClone(original);
    vi.mocked(api.shortcuts.get).mockImplementation(async () => structuredClone(persisted));
    let calls = 0;
    const save = vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
      calls++;
      if (calls === 1) {
        persisted.groups[0]!.links.push(y);
        persisted.revision++;
      } else if (calls === 2) {
        persisted.groups[0]!.links = [y];
        persisted.groups.push({
          id: "b",
          name: "B",
          collapsed: false,
          links: [{ ...x, name: "원격 수정 X" }],
        });
        persisted.revision++;
      } else {
        persisted = { ...structuredClone(input), revision: input.revision + 1 };
        return persisted;
      }
      throw new ApiError("다른 곳", "CONFLICT");
    });
    setup();
    await screen.findByRole("link", { name: "X 새 탭에서 열기" });
    fireEvent.click(screen.getByRole("button", { name: "정리" }));
    if (explicitDelete) fireEvent.click(screen.getByRole("button", { name: "X 바로가기 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "A 분류 삭제" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    for (let round = 0; round < 2; round++) {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      fireEvent.click(await screen.findByRole("button", { name: "최신 변경과 합치기" }));
      await screen.findByRole("button", { name: "저장" });
      if (round === 0) expect(screen.getByRole("button", { name: "A 1" })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "원격 수정 X 바로가기 수정" }) !== null).toBe(
      !explicitDelete,
    );
    expect(screen.getByRole("button", { name: "Y 바로가기 수정" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("button", { name: "정리" });
    expect(save).toHaveBeenCalledTimes(3);
    expect(persisted.groups.map((group) => group.id)).toEqual(["b"]);
    expect(persisted.groups[0]!.links.map((link) => link.id).sort()).toEqual(
      explicitDelete ? ["y"] : ["x", "y"],
    );
  },
);

it("임시 복원 분류의 이름과 접힘 편집을 다음 저장 충돌 후에도 저장한다", async () => {
  let persisted: ShortcutBoard = {
    revision: 1,
    groups: [{ id: "a", name: "A", collapsed: false, links: [] }],
  };
  vi.mocked(api.shortcuts.get).mockImplementation(async () => structuredClone(persisted));
  let calls = 0;
  vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
    calls++;
    if (calls === 1)
      persisted.groups[0]!.links = [{ id: "x", name: "X", url: "https://example.com/X" }];
    else if (calls === 2) persisted.groups[0]!.links[0]!.name = "서버 수정 X";
    else {
      persisted = { ...structuredClone(input), revision: input.revision + 1 };
      return persisted;
    }
    persisted.revision++;
    throw new ApiError("다른 곳", "CONFLICT");
  });
  setup();
  await screen.findByRole("button", { name: "A 0" });
  fireEvent.click(screen.getByRole("button", { name: "정리" }));
  fireEvent.click(screen.getByRole("button", { name: "A 분류 삭제" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "삭제" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  fireEvent.click(await screen.findByRole("button", { name: "최신 변경과 합치기" }));
  await screen.findByRole("button", { name: "A 1" });
  fireEvent.click(screen.getByRole("button", { name: "A 분류 이름 수정" }));
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "직접 수정 A" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "완료" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "직접 수정 A 1" }));
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  fireEvent.click(await screen.findByRole("button", { name: "최신 변경과 합치기" }));
  await screen.findByRole("button", { name: "저장" });
  expect(screen.getByRole("button", { name: "직접 수정 A 1" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByRole("button", { name: "정리" });
  expect(persisted.groups[0]).toEqual({
    id: "a",
    name: "직접 수정 A",
    collapsed: true,
    links: [{ id: "x", name: "서버 수정 X", url: "https://example.com/X" }],
  });
});

it.each(["keep", "delete", "cancel"])(
  "직접 이동 후 원래 분류로 복귀해도 이동 기록을 정리 세션에 유지한다 %s",
  async (action) => {
    let persisted: ShortcutBoard = {
      revision: 1,
      groups: [
        {
          id: "a",
          name: "A",
          collapsed: false,
          links: [{ id: "x", name: "X", url: "https://example.com/X" }],
        },
        { id: "b", name: "B", collapsed: false, links: [] },
      ],
    };
    vi.mocked(api.shortcuts.get).mockImplementation(async () => structuredClone(persisted));
    let calls = 0;
    vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
      calls++;
      if (calls === 1) persisted.groups.pop();
      else if (calls === 2) persisted.groups[0]!.links = [];
      else {
        persisted = { ...structuredClone(input), revision: input.revision + 1 };
        return persisted;
      }
      persisted.revision++;
      throw new ApiError("다른 곳", "CONFLICT");
    });
    setup();
    await screen.findByRole("link", { name: "X 새 탭에서 열기" });
    fireEvent.click(screen.getByRole("button", { name: "정리" }));
    fireEvent.click(screen.getByRole("button", { name: "X 바로가기 수정" }));
    fireEvent.change(screen.getByLabelText("분류"), { target: { value: "b" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "완료" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    fireEvent.click(await screen.findByRole("button", { name: "최신 변경과 합치기" }));
    await screen.findByRole("button", { name: "X 바로가기 수정" });
    expect(screen.getByRole("button", { name: "A 1" })).toBeInTheDocument();
    if (action === "delete")
      fireEvent.click(screen.getByRole("button", { name: "X 바로가기 삭제" }));
    if (action === "cancel") {
      fireEvent.click(screen.getByRole("button", { name: "취소" }));
      fireEvent.click(await screen.findByRole("button", { name: "정리" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    fireEvent.click(await screen.findByRole("button", { name: "최신 변경과 합치기" }));
    await screen.findByRole("button", { name: "저장" });
    expect(screen.queryByRole("button", { name: "X 바로가기 수정" }) !== null).toBe(
      action === "keep",
    );
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("button", { name: "정리" });
    expect(persisted.groups[0]!.links.map((link) => link.id)).toEqual(
      action === "keep" ? ["x"] : [],
    );
  },
);
