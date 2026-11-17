import { reconcileShortcutBoard, type AutomaticShortcutPlacement } from "./shortcuts";
import type { ShortcutBoard } from "@/types/domain";

export type MergeRequest = {
  base: ShortcutBoard;
  draft: ShortcutBoard;
  latest: ShortcutBoard;
  deletedLinkIds: ReadonlySet<string>;
  automaticLinkGroups: Map<string, AutomaticShortcutPlacement>;
  deletedGroupIds: ReadonlySet<string>;
  movedLinkOrigins: Map<string, string>;
  reorderedLinkGroups: Map<string, string>;
};
export type MergeResponse = Pick<
  MergeRequest,
  "automaticLinkGroups" | "movedLinkOrigins" | "reorderedLinkGroups"
> & { board: ShortcutBoard };

export async function mergeShortcutBoard(
  base: ShortcutBoard,
  draft: ShortcutBoard,
  latest: ShortcutBoard,
  deletedLinkIds: ReadonlySet<string> = new Set(),
  automaticLinkGroups: Map<string, AutomaticShortcutPlacement> = new Map(),
  deletedGroupIds: ReadonlySet<string> = new Set(),
  movedLinkOrigins: Map<string, string> = new Map(),
  reorderedLinkGroups: Map<string, string> = new Map(),
): Promise<ShortcutBoard> {
  const largest = Math.max(
    ...[base, draft, latest].map((board) =>
      board.groups.reduce((count, group) => count + group.links.length, 0),
    ),
  );
  if (largest < 100 || typeof Worker === "undefined")
    return reconcileShortcutBoard(
      base,
      draft,
      latest,
      deletedLinkIds,
      automaticLinkGroups,
      deletedGroupIds,
      movedLinkOrigins,
      reorderedLinkGroups,
    );
  const worker = new Worker(new URL("./shortcut-merge.worker.ts", import.meta.url), {
    type: "module",
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await new Promise<MergeResponse>((resolve, reject) => {
      const fail = () =>
        reject(new Error("최신 변경을 합치지 못했습니다. 입력은 유지됩니다. 다시 시도하세요."));
      worker.onmessage = (event: MessageEvent<MergeResponse>) => resolve(event.data);
      worker.onerror = fail;
      worker.onmessageerror = fail;
      timeout = setTimeout(fail, 30_000);
      worker.postMessage({
        base,
        draft,
        latest,
        deletedLinkIds,
        automaticLinkGroups,
        deletedGroupIds,
        movedLinkOrigins,
        reorderedLinkGroups,
      } satisfies MergeRequest);
    });
    automaticLinkGroups.clear();
    movedLinkOrigins.clear();
    reorderedLinkGroups.clear();
    for (const [id, placement] of response.automaticLinkGroups)
      automaticLinkGroups.set(id, placement);
    for (const [id, group] of response.movedLinkOrigins) movedLinkOrigins.set(id, group);
    for (const [id, group] of response.reorderedLinkGroups) reorderedLinkGroups.set(id, group);
    return response.board;
  } finally {
    clearTimeout(timeout);
    worker.terminate();
  }
}
