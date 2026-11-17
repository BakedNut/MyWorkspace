import type { ReactNode } from "react";
import type { CollisionDetection, KeyboardCoordinateGetter } from "@dnd-kit/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { ShortcutBoard } from "./ShortcutBoard";

const captured = vi.hoisted(() => ({
  collision: undefined as CollisionDetection | undefined,
  keyboard: undefined as KeyboardCoordinateGetter | undefined,
}));
vi.mock("@dnd-kit/core", async (original) => ({
  ...(await original<typeof import("@dnd-kit/core")>()),
  DndContext: ({
    collisionDetection,
    children,
    sensors,
  }: {
    collisionDetection: CollisionDetection;
    children: ReactNode;
    sensors: { options: { coordinateGetter?: KeyboardCoordinateGetter } }[];
  }) => {
    captured.collision = collisionDetection;
    captured.keyboard = sensors.find((sensor) => sensor.options.coordinateGetter)?.options
      .coordinateGetter;
    return children;
  },
}));
vi.mock("@dnd-kit/sortable", async (original) => ({
  ...(await original<typeof import("@dnd-kit/sortable")>()),
  sortableKeyboardCoordinates: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
const measured: [string, ReturnType<typeof rect>][] = [
  ["group:b", rect(304, 184, 1072, 221)],
  ["link:b1", rect(321, 261, 338, 127)],
  ["group:c", rect(304, 425, 1072, 62)],
  ["group:a", rect(304, 507, 1072, 221)],
  ["link:a2", rect(671, 584, 338, 127)],
];
function detect(
  collisionRect: ReturnType<typeof rect>,
  kind = "link",
  pointerCoordinates: { x: number; y: number } | null = null,
) {
  render(
    <ShortcutBoard
      board={{ revision: 0, groups: [] }}
      editing
      busy={false}
      onChange={vi.fn()}
      onEditLink={vi.fn()}
      onEditGroup={vi.fn()}
      onDeleteGroup={vi.fn()}
    />,
  );
  const args = {
    active: { id: "link:a1", data: { current: { kind } } },
    collisionRect,
    pointerCoordinates,
    droppableRects: new Map(measured),
    droppableContainers: measured.map(([id]) => ({
      id,
      data: { current: { kind: id.startsWith("group:") ? "group" : "link" } },
    })),
  } as unknown as Parameters<CollisionDetection>[0];
  return captured.collision!(args)[0]?.id;
}
it("키보드 오버레이가 빈 접힌 분류에 겹치면 인접 링크 대신 해당 분류를 선택한다", () => {
  expect(detect(rect(304, 425, 338, 127))).toBe("group:c");
});
it("키보드로 링크 위에 놓으면 해당 링크를 선택한다", () => {
  expect(detect(rect(671, 584, 338, 127))).toBe("link:a2");
});
it("분류 이동은 내부 링크를 제외하고 분류만 선택한다", () => {
  expect(detect(rect(304, 507, 1072, 221), "group")).toBe("group:a");
});
it("포인터로 링크 위에 놓으면 내부 링크를 우선한다", () => {
  expect(detect(rect(671, 584, 338, 127), "link", { x: 750, y: 620 })).toBe("link:a2");
});
it("교차 대상이 없는 키보드 좌표에서는 가까운 대상을 사용한다", () => {
  expect(detect(rect(304, 10, 338, 127))).toBe("link:b1");
});

it.each(["link", "group"])("키보드 %s 이동의 후보에서 중복된 분류와 링크를 제외한다", (kind) => {
  detect(rect(304, 425, 338, 127));
  const containers = [
    { id: "open", data: { current: { kind: "group", acceptsLink: false } } },
    { id: "empty", data: { current: { kind: "group", acceptsLink: true } } },
    { id: "link", data: { current: { kind: "link" } } },
  ];
  const rects = new Map(containers.map((item) => [item.id, rect(0, 0, 100, 100)]));
  const args = {
    context: {
      active: { data: { current: { kind } } },
      droppableRects: rects,
      droppableContainers: { getEnabled: () => containers },
    },
  } as unknown as Parameters<KeyboardCoordinateGetter>[1];
  captured.keyboard!(new KeyboardEvent("keydown", { code: "ArrowUp" }), args);
  const passed = vi.mocked(sortableKeyboardCoordinates).mock.calls[0]![1].context.droppableRects;
  expect([...passed.keys()]).toEqual(kind === "link" ? ["empty", "link"] : ["open", "empty"]);
  expect(rects.size).toBe(3);
});

it("접힌 분류는 유지하고 내부 링크는 해제하며 펼치면 다시 등록한다", () => {
  const board = {
    revision: 0,
    groups: [
      {
        id: "open",
        name: "열린 분류",
        collapsed: false,
        links: [{ id: "visible", name: "표시 링크", url: "https://example.com/" }],
      },
      {
        id: "closed",
        name: "접힌 분류",
        collapsed: true,
        links: [{ id: "hidden", name: "숨은 링크", url: "https://example.org/" }],
      },
    ],
  };
  const props = {
    editing: true,
    busy: false,
    onChange: vi.fn(),
    onEditLink: vi.fn(),
    onEditGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
  };
  const { container, rerender } = render(<ShortcutBoard {...props} board={board} />);
  expect(container.querySelector('[data-group-id="closed"]')).toBeInTheDocument();
  expect(container.querySelector('[data-link-id="visible"]')).toBeInTheDocument();
  expect(container.querySelector('[data-link-id="hidden"]')).not.toBeInTheDocument();
  rerender(
    <ShortcutBoard
      {...props}
      board={{ ...board, groups: board.groups.map((group) => ({ ...group, collapsed: false })) }}
    />,
  );
  expect(container.querySelector('[data-link-id="hidden"]')).toBeInTheDocument();
  expect(board.groups[1]!.links[0]!.id).toBe("hidden");
});
