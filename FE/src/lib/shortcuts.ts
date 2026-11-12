import { arrayMove } from "@dnd-kit/sortable";
import type { ShortcutBoard } from "@/types/domain";

export function normalizeShortcutUrl(input: string): string {
  const value = input.trim();
  if (!value || value.length > 2048 || /\p{Cc}/u.test(value))
    throw new Error("사이트 주소를 확인하세요. URL은 2048자까지 입력할 수 있습니다.");
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  const hostWithPort = /^[^/:?#]+:\d+(?:[/?#]|$)/.test(value);
  let url: URL;
  try {
    url = new URL(hasScheme && !hostWithPort ? value : `https://${value}`);
  } catch {
    throw new Error("올바른 사이트 주소를 입력하세요.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password)
    throw new Error("http 또는 https 사이트 주소를 입력하세요.");
  if (url.href.length > 2048) throw new Error("URL은 2048자까지 입력할 수 있습니다.");
  return url.href;
}

export function moveShortcut(
  board: ShortcutBoard,
  linkId: string,
  groupId: string,
  targetLinkId?: string,
): ShortcutBoard {
  const source = board.groups.find((group) => group.links.some((link) => link.id === linkId));
  const target = board.groups.find((group) => group.id === groupId);
  if (!source || !target || linkId === targetLinkId) return board;
  const sourceIndex = source.links.findIndex((link) => link.id === linkId);
  const targetIndex = targetLinkId
    ? target.links.findIndex((link) => link.id === targetLinkId)
    : target.links.length;
  if (targetIndex < 0) return board;
  if (source.id === target.id)
    return {
      ...board,
      groups: board.groups.map((group) =>
        group.id === source.id
          ? {
              ...group,
              links: arrayMove(
                group.links,
                sourceIndex,
                Math.min(targetIndex, group.links.length - 1),
              ),
            }
          : group,
      ),
    };
  const moved = [...target.links];
  moved.splice(targetIndex, 0, source.links[sourceIndex]!);
  return {
    ...board,
    groups: board.groups.map((group) => {
      if (group.id === source.id)
        return { ...group, links: group.links.filter((link) => link.id !== linkId) };
      if (group.id === target.id) return { ...group, links: moved };
      return group;
    }),
  };
}

// Keep unchanged fields from the server and apply only edits made since the draft began.
function mergeShortcutItems<T extends { id: string }>(base: T[], draft: T[], latest: T[]): T[] {
  const original = new Map(base.map((item) => [item.id, item]));
  const local = new Map(draft.map((item) => [item.id, item]));
  const remote = new Map(latest.map((item) => [item.id, item]));
  const merged = new Map<string, T>();
  for (const id of new Set([...remote.keys(), ...local.keys()])) {
    const before = original.get(id);
    const edited = local.get(id);
    const saved = remote.get(id);
    if (!edited) {
      if (!before && saved) merged.set(id, saved);
      continue;
    }
    if (!saved) {
      if (JSON.stringify(edited) !== JSON.stringify(before)) merged.set(id, edited);
      continue;
    }
    const item = { ...saved };
    for (const key of Object.keys(edited) as (keyof T)[]) {
      if (JSON.stringify(edited[key]) !== JSON.stringify(before?.[key])) item[key] = edited[key];
    }
    merged.set(id, item);
  }
  const common = new Set(base.filter((item) => local.has(item.id)).map((item) => item.id));
  const reordered =
    base
      .filter((item) => common.has(item.id))
      .map((item) => item.id)
      .join("\n") !==
    draft
      .filter((item) => common.has(item.id))
      .map((item) => item.id)
      .join("\n");
  const preferred = reordered ? draft : latest;
  const secondary = reordered ? latest : draft;
  const order = preferred.map((item) => item.id).filter((id) => merged.has(id));
  for (let index = 0; index < secondary.length; index++) {
    const id = secondary[index]!.id;
    if (!merged.has(id) || order.includes(id)) continue;
    const previous = secondary
      .slice(0, index)
      .reverse()
      .find((item) => order.includes(item.id));
    const next = secondary.slice(index + 1).find((item) => order.includes(item.id));
    const position = previous
      ? order.indexOf(previous.id) + 1
      : next
        ? order.indexOf(next.id)
        : order.length;
    order.splice(position, 0, id);
  }
  return order.map((id) => merged.get(id)!);
}

export function reconcileShortcutBoard(
  base: ShortcutBoard,
  draft: ShortcutBoard,
  latest: ShortcutBoard,
): ShortcutBoard {
  const links = (board: ShortcutBoard) =>
    board.groups.flatMap((group) => group.links.map((link) => ({ ...link, groupId: group.id })));
  const mergedLinks = mergeShortcutItems(links(base), links(draft), links(latest));
  const groups = mergeShortcutItems(base.groups, draft.groups, latest.groups);
  return {
    revision: latest.revision,
    groups: groups.map((group) => {
      const members = mergedLinks.filter((link) => link.groupId === group.id);
      const memberIds = new Set(members.map((link) => link.id));
      const order = mergeShortcutItems(
        base.groups.find((item) => item.id === group.id)?.links ?? [],
        draft.groups.find((item) => item.id === group.id)?.links ?? [],
        latest.groups.find((item) => item.id === group.id)?.links ?? [],
      ).filter((link) => memberIds.has(link.id));
      const orderedIds = new Set(order.map((link) => link.id));
      const byId = new Map(members.map((link) => [link.id, link]));
      return {
        ...group,
        links: [
          ...order.map((link) => byId.get(link.id)!),
          ...members.filter((link) => !orderedIds.has(link.id)),
        ].map(({ groupId: _groupId, ...link }) => link),
      };
    }),
  };
}
