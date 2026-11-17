import { afterEach, expect, it, vi } from "vitest";
import { mergeShortcutBoard, type MergeRequest, type MergeResponse } from "./shortcut-merge";
import { reconcileShortcutBoard, type AutomaticShortcutPlacement } from "./shortcuts";
import * as synchronous from "./shortcuts";
import type { ShortcutBoard } from "@/types/domain";

class FakeWorker {
  static instances: FakeWorker[] = [];
  request!: MergeRequest;
  onmessage: ((event: MessageEvent<MergeResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: MergeRequest) {
    this.request = structuredClone(request);
  }
  complete() {
    const r = this.request;
    const board = reconcileShortcutBoard(
      r.base,
      r.draft,
      r.latest,
      r.deletedLinkIds,
      r.automaticLinkGroups,
      r.deletedGroupIds,
      r.movedLinkOrigins,
      r.reorderedLinkGroups,
    );
    this.onmessage?.(
      new MessageEvent("message", {
        data: {
          board,
          automaticLinkGroups: r.automaticLinkGroups,
          movedLinkOrigins: r.movedLinkOrigins,
          reorderedLinkGroups: r.reorderedLinkGroups,
        },
      }),
    );
  }
}
function board(count: number): ShortcutBoard {
  return {
    revision: 1,
    groups: [
      {
        id: "a",
        name: "A",
        collapsed: false,
        links: Array.from({ length: count }, (_, i) => ({
          id: `x${i}`,
          name: `X${i}`,
          url: `https://example.com/${i}`,
        })),
      },
    ],
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeWorker.instances = [];
});

it.each([50, 100, 200])("%i개 링크의 다른 회전·교차 재정렬 결과를 보존한다", async (count) => {
  vi.stubGlobal("Worker", FakeWorker);
  const base = board(count),
    links = base.groups[0]!.links;
  const quarter = Math.floor(count / 4),
    half = count / 2;
  const blocks = [
    links.slice(0, quarter),
    links.slice(quarter, half),
    links.slice(half, Math.floor((3 * count) / 4)),
    links.slice(Math.floor((3 * count) / 4)),
  ];
  for (const pattern of ["rotations", "quarters"]) {
    const draft = structuredClone(base),
      latest = structuredClone(base);
    draft.groups[0]!.links =
      pattern === "rotations"
        ? [...links.slice(half), ...links.slice(0, half)]
        : [blocks[2]!, blocks[0]!, blocks[3]!, blocks[1]!].flat();
    latest.groups[0]!.links =
      pattern === "rotations"
        ? [...links.slice(quarter), ...links.slice(0, quarter)]
        : [blocks[1]!, blocks[3]!, blocks[0]!, blocks[2]!].flat();
    const promise = mergeShortcutBoard(base, draft, latest);
    const worker = FakeWorker.instances.at(-1);
    if (count >= 100) worker!.complete();
    const result = await promise;
    const expected =
      pattern === "rotations"
        ? [...links.slice(half), ...links.slice(quarter, half), ...links.slice(0, quarter)]
        : blocks.slice().reverse().flat();
    expect(result.groups[0]!.links).toEqual(expected);
    expect(new Set(result.groups[0]!.links.map((link) => link.id)).size).toBe(count);
    if (count >= 100) expect(worker!.terminate).toHaveBeenCalledOnce();
  }
  expect(FakeWorker.instances.length).toBe(count >= 100 ? 2 : 0);
});

it("동시 추가·삭제와 명시 이동의 추적 맵을 보존한다", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const base = board(198);
  base.groups.push({ id: "b", name: "B", collapsed: false, links: [] });
  const draft = structuredClone(base),
    latest = structuredClone(base);
  const moved = draft.groups[0]!.links.shift()!;
  draft.groups[1]!.links = [moved];
  draft.groups[0]!.links = draft.groups[0]!.links.filter((link) => link.id !== "x1").reverse();
  draft.groups[0]!.links.push({ id: "local", name: "Local", url: "https://local.test/" });
  draft.groups[0]!.links.find((link) => link.id === "x3")!.name = "Local edit";
  latest.groups[0]!.links = latest.groups[0]!.links.filter(
    (link) => !["x0", "x2"].includes(link.id),
  );
  latest.groups[0]!.links.push({ id: "remote", name: "Remote", url: "https://remote.test/" });
  latest.groups[0]!.links.find((link) => link.id === "x3")!.name = "Remote edit";
  const placements = new Map<string, AutomaticShortcutPlacement>();
  const origins = new Map([["x0", "a"]]);
  const reordered = new Map<string, string>();
  const expectedOrigins = structuredClone(origins),
    expectedPlacements = structuredClone(placements),
    expectedReordered = structuredClone(reordered);
  const expected = reconcileShortcutBoard(
    base,
    draft,
    latest,
    new Set(["x1"]),
    expectedPlacements,
    new Set(),
    expectedOrigins,
    expectedReordered,
  );
  const promise = mergeShortcutBoard(
    base,
    draft,
    latest,
    new Set(["x1"]),
    placements,
    new Set(),
    origins,
    reordered,
  );
  expect(origins).toEqual(new Map([["x0", "a"]]));
  FakeWorker.instances[0]!.complete();
  const result = await promise;
  expect(result).toEqual(expected);
  expect(placements).toEqual(expectedPlacements);
  expect(origins).toEqual(expectedOrigins);
  expect(reordered).toEqual(expectedReordered);
  const ids = result.groups.flatMap((group) => group.links.map((link) => link.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toHaveLength(198);
  expect(ids).not.toContain("x1");
  expect(ids).not.toContain("x2");
  expect(ids).toContain("local");
  expect(ids).toContain("remote");
  expect(result.groups[1]!.links.map((link) => link.id)).toContain("x0");
  expect(result.groups.flatMap((group) => group.links).find((link) => link.id === "x3")!.name).toBe(
    "Local edit",
  );
});

it.each(["error", "messageerror", "timeout"])(
  "워커 %s 실패 시 초안과 추적 상태를 보존하고 종료한다",
  async (failure) => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.useFakeTimers();
    const input = board(200),
      placements = new Map([["x1", { groupId: "a", order: ["x1"] }]]);
    const promise = mergeShortcutBoard(input, input, input, new Set(), placements);
    const rejected = expect(promise).rejects.toThrow("입력은 유지됩니다");
    const worker = FakeWorker.instances[0]!;
    if (failure === "timeout") await vi.advanceTimersByTimeAsync(30_000);
    else if (failure === "error") worker.onerror?.();
    else worker.onmessageerror?.();
    await rejected;
    expect(placements.get("x1")).toEqual({ groupId: "a", order: ["x1"] });
    expect(worker.terminate).toHaveBeenCalledOnce();
  },
);

it("큰 병합은 UI 스레드에서 동기 알고리즘을 실행하지 않고 워커 응답을 기다린다", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const input = board(200);
  const synchronousMerge = vi.spyOn(synchronous, "reconcileShortcutBoard");
  const pending = mergeShortcutBoard(input, input, input);
  expect(FakeWorker.instances).toHaveLength(1);
  expect(synchronousMerge).not.toHaveBeenCalled();
  FakeWorker.instances[0]!.complete();
  expect(await pending).toEqual(input);
});
