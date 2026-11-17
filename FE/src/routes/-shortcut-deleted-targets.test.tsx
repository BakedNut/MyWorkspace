import type { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "@/api";
import type { ShortcutBoard } from "@/types/domain";
import { Route } from "./shortcuts";

// Invoke the route's edit callbacks directly to keep a dialog open across a 409 refresh.
vi.mock("@/components/ShortcutBoard", () => ({
  ShortcutBoard: ({
    board,
    onEditLink,
    onEditGroup,
  }: {
    board: ShortcutBoard;
    onEditLink: (link: ShortcutBoard["groups"][number]["links"][number], groupId: string) => void;
    onEditGroup: (group: ShortcutBoard["groups"][number]) => void;
  }) => (
    <>
      {board.groups.map((group) => (
        <div key={group.id}>
          <button onClick={() => onEditGroup(group)}>분류 수정</button>
          {group.links.map((link) => (
            <button key={link.id} onClick={() => onEditLink(link, group.id)}>
              링크 수정
            </button>
          ))}
        </div>
      ))}
    </>
  ),
}));
const Page = Route.options.component as ComponentType;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["link", "group"])(
  "409로 삭제를 확인한 %s 수정은 자동 복원하거나 성공 처리하지 않는다",
  async (kind) => {
    let server: ShortcutBoard = {
      revision: 1,
      groups: [
        {
          id: "dev",
          name: "개발",
          collapsed: false,
          links: [{ id: "x", name: "X", url: "https://example.com/" }],
        },
      ],
    };
    const get = vi
      .spyOn(api.shortcuts, "get")
      .mockImplementation(async () => structuredClone(server));
    const save = vi.spyOn(api.shortcuts, "save").mockImplementation(async (input) => {
      if (input.revision !== server.revision) throw new ApiError("다른 탭에서 삭제", "CONFLICT");
      server = structuredClone({ ...input, revision: input.revision + 1 });
      return structuredClone(server);
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Page />
      </QueryClientProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: kind === "link" ? "링크 수정" : "분류 수정" }),
    );
    const modal = screen.getByRole("dialog");
    fireEvent.change(within(modal).getByLabelText("이름"), { target: { value: "변경 이름" } });
    server.revision++;
    if (kind === "link") server.groups[0]!.links = [];
    else server.groups = [];
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    await within(modal).findByText("다른 탭에서 삭제");
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
    await waitFor(() => expect(within(modal).getByRole("alert")).toHaveTextContent("삭제"));
    expect(save).toHaveBeenCalledOnce();
    expect(within(modal).getByLabelText("이름")).toHaveValue("변경 이름");
    expect(server.revision).toBe(2);
    if (kind === "link") {
      fireEvent.click(within(modal).getByRole("button", { name: "다시 추가" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(server.groups[0]!.links[0]).toEqual({
        id: "x",
        name: "변경 이름",
        url: "https://example.com/",
      });
      expect(save).toHaveBeenCalledTimes(2);
    } else {
      fireEvent.click(within(modal).getByRole("button", { name: "완료" }));
      expect(save).toHaveBeenCalledOnce();
      expect(server.groups).toEqual([]);
      fireEvent.click(within(modal).getByRole("button", { name: "취소" }));
    }
  },
);
