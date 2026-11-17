import { reconcileShortcutBoard } from "./shortcuts";
import type { MergeRequest, MergeResponse } from "./shortcut-merge";

self.onmessage = (event: MessageEvent<MergeRequest>) => {
  const request = event.data;
  const board = reconcileShortcutBoard(
    request.base,
    request.draft,
    request.latest,
    request.deletedLinkIds,
    request.automaticLinkGroups,
    request.deletedGroupIds,
    request.movedLinkOrigins,
    request.reorderedLinkGroups,
  );
  self.postMessage({
    board,
    automaticLinkGroups: request.automaticLinkGroups,
    movedLinkOrigins: request.movedLinkOrigins,
    reorderedLinkGroups: request.reorderedLinkGroups,
  } satisfies MergeResponse);
};
