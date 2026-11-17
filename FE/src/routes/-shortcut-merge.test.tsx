import type { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "@/api";
import * as merge from "@/lib/shortcut-merge";
import { reconcileShortcutBoard } from "@/lib/shortcuts";
import type { ShortcutBoard } from "@/types/domain";
import { Route } from "./shortcuts";
const Page = Route.options.component as ComponentType;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([false, true])(
  "비동기 병합 동안 조작을 잠그고 초안과 재시도를 보존한다 실패 %s",
  async (fail) => {
    const base: ShortcutBoard = {
      revision: 4,
      groups: [
        {
          id: "a",
          name: "A",
          collapsed: false,
          links: [
            { id: "x", name: "X", url: "https://example.com/" },
            { id: "y", name: "Y", url: "https://example.org/" },
          ],
        },
      ],
    };
    let server = structuredClone(base);
    vi.spyOn(api.shortcuts, "get").mockImplementation(async () => structuredClone(server));
    const save = vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
      if (input.revision !== server.revision) throw new ApiError("다른 탭 변경", "CONFLICT");
      server = structuredClone({ ...input, revision: input.revision + 1 });
      return structuredClone(server);
    });
    let resolve!: (board: ShortcutBoard) => void;
    let reject!: (issue: Error) => void;
    const pending = new Promise<ShortcutBoard>((done, failed) => {
      resolve = done;
      reject = failed;
    });
    const mergeRequest = vi.spyOn(merge, "mergeShortcutBoard").mockReturnValueOnce(pending);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Page />
      </QueryClientProvider>,
    );
    await screen.findByRole("link", { name: "X 새 탭에서 열기" });
    fireEvent.click(screen.getByRole("button", { name: "정리" }));
    fireEvent.click(screen.getByRole("button", { name: "X 바로가기 수정" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("이름"), { target: { value: "Local" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "완료" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    server.revision++;
    server.groups[0]!.links[1]!.name = "Remote";
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    fireEvent.click(await screen.findByRole("button", { name: "최신 변경과 합치기" }));
    await waitFor(() => expect(mergeRequest).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "합치는 중…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    expect(save).toHaveBeenCalledOnce();
    const draft = structuredClone(base);
    draft.groups[0]!.links[0]!.name = "Local";
    const result = reconcileShortcutBoard(base, draft, server);
    if (fail) {
      reject(new Error("워커 응답 실패"));
      await screen.findByText("워커 응답 실패");
      expect(screen.getByRole("button", { name: "Local 바로가기 수정" })).toBeInTheDocument();
      mergeRequest.mockResolvedValueOnce(result);
      fireEvent.click(screen.getByRole("button", { name: "최신 변경과 합치기" }));
    } else resolve(result);
    fireEvent.click(await screen.findByRole("button", { name: "저장" }));
    await screen.findByRole("button", { name: "정리" });
    expect(server.groups[0]!.links.map((link) => link.name)).toEqual(["Local", "Remote"]);
    expect(save).toHaveBeenCalledTimes(2);
  },
);
