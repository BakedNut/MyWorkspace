import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ShortcutDialog } from "./ShortcutDialogs";

afterEach(cleanup);

it.each([false, true])(
  "자동 분류 표시가 바뀌어도 직접 선택 횟수를 유지한다 %s",
  async (initialManualSelection) => {
    const props = {
      target: { kind: "link" as const },
      groups: ["a", "b", "c"].map((id) => ({ id, name: id, collapsed: false, links: [] })),
      onClose: vi.fn(),
      onRestoreFocus: vi.fn(),
      onSaveLink: vi.fn().mockRejectedValue(new Error("응답 유실")),
      onSaveGroup: vi.fn(),
      onDeleteGroup: vi.fn(),
    };
    const view = render(<ShortcutDialog {...props} />);
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "첫 이름" } });
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com/" },
    });
    if (initialManualSelection)
      fireEvent.change(screen.getByLabelText("분류"), { target: { value: "b" } });
    const version = initialManualSelection ? 1 : 0;
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    await screen.findByRole("alert");
    expect(props.onSaveLink).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupSelectionVersion: version, automaticGroupSelection: false }),
    );
    for (const group of initialManualSelection ? ["c", "a"] : ["b", "c"]) {
      view.rerender(
        <ShortcutDialog
          {...props}
          currentGroupId={group}
          baselineGroupSelectionVersion={version}
        />,
      );
      expect(screen.getByLabelText("분류")).toHaveValue(group);
      fireEvent.change(screen.getByLabelText("이름"), { target: { value: `수정 ${group}` } });
      fireEvent.click(screen.getByRole("button", { name: "완료" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "완료" })).toBeEnabled());
      expect(props.onSaveLink).toHaveBeenLastCalledWith(
        expect.objectContaining({
          groupId: group,
          groupSelectionVersion: version,
          automaticGroupSelection: true,
        }),
      );
    }
    const chosen = initialManualSelection ? "b" : "a";
    fireEvent.change(screen.getByLabelText("분류"), { target: { value: chosen } });
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "완료" })).toBeEnabled());
    expect(props.onSaveLink).toHaveBeenLastCalledWith(
      expect.objectContaining({
        groupId: chosen,
        groupSelectionVersion: version + 1,
        automaticGroupSelection: false,
      }),
    );
    expect(props.onClose).not.toHaveBeenCalled();
  },
);
