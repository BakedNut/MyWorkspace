import { arrayMove } from "@dnd-kit/sortable";
import type { ShortcutBoard } from "@/types/domain";

// Java URI rejects some characters that the browser URL parser preserves.
function encodeShortcutUriPart(value: string): string {
  return value
    .replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@/%?]/gu, (character) => encodeURIComponent(character))
    .replace(/%(?![0-9a-f]{2})/gi, "%25");
}

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
  if (!url.hostname.startsWith("[")) {
    const host = url.hostname.replace(/\.$/, "");
    const labels = host.split(".");
    const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
    if (
      !labels.every((label) => /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)) ||
      (labels.length > 1 && !ipv4 && !/^[a-z]/i.test(labels[labels.length - 1]!))
    )
      throw new Error("사이트의 호스트 주소를 확인하세요.");
  }
  url.pathname = encodeShortcutUriPart(url.pathname);
  url.search = encodeShortcutUriPart(url.search);
  if (url.hash) url.hash = "#" + encodeShortcutUriPart(url.hash.slice(1));
  if (url.href.length > 2048) throw new Error("URL은 2048자까지 입력할 수 있습니다.");
  return url.href;
}

export function parseShortcutUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      /\p{Cc}/u.test(value)
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

// Apply reordered existing pairs first, then compatible saved and inserted order.
function mergeShortcutOrder(
  base: string[],
  draft: string[],
  latest: string[],
  ids: string[],
): string[] {
  const following = new Map(ids.map((id) => [id, new Set<string>()]));
  const original = new Map(base.map((id, index) => [id, index]));
  const constrain = (items: string[], changesOnly: boolean) => {
    const present = items.filter((id) => following.has(id));
    for (let left = 0; left < present.length; left++) {
      for (let right = left + 1; right < present.length; right++) {
        const before = present[left]!;
        const after = present[right]!;
        if (
          changesOnly &&
          (!original.has(before) ||
            !original.has(after) ||
            original.get(before)! < original.get(after)!)
        )
          continue;
        if (following.get(before)!.has(after) || following.get(after)!.has(before)) continue;
        const successors = [after, ...following.get(after)!];
        for (const [id, reachable] of following) {
          if (id === before || reachable.has(before)) {
            for (const next of successors) reachable.add(next);
          }
        }
      }
    }
  };
  constrain(draft, true);
  constrain(latest, true);
  constrain(latest, false);
  constrain(draft, false);
  const remaining = [...new Set([...latest, ...draft, ...ids])].filter((id) => following.has(id));
  const order: string[] = [];
  while (remaining.length) {
    const index = remaining.findIndex(
      (id) => !remaining.some((other) => following.get(other)!.has(id)),
    );
    order.push(remaining.splice(index, 1)[0]!);
  }
  return order;
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
  return mergeShortcutOrder(
    base.map((item) => item.id),
    draft.map((item) => item.id),
    latest.map((item) => item.id),
    [...merged.keys()],
  ).map((id) => merged.get(id)!);
}

export function reconcileShortcutBoard(
  base: ShortcutBoard,
  draft: ShortcutBoard,
  latest: ShortcutBoard,
  deletedLinkIds: ReadonlySet<string> = new Set(),
): ShortcutBoard {
  const links = (board: ShortcutBoard) =>
    board.groups.flatMap((group) => group.links.map((link) => ({ ...link, groupId: group.id })));
  const baseLinks = links(base);
  const latestLinks = links(latest);
  const mergedLinks = mergeShortcutItems(baseLinks, links(draft), latestLinks).filter(
    (link) => !deletedLinkIds.has(link.id),
  );
  for (const saved of latestLinks) {
    const original = baseLinks.find((link) => link.id === saved.id);
    if (
      original &&
      !deletedLinkIds.has(saved.id) &&
      original.groupId !== saved.groupId &&
      !draft.groups.some((group) => group.id === original.groupId) &&
      !mergedLinks.some((link) => link.id === saved.id)
    )
      mergedLinks.push(saved);
  }
  const properties = (board: ShortcutBoard) =>
    board.groups.map(({ links: _links, ...group }) => group);
  const groups: ShortcutBoard["groups"] = mergeShortcutItems(
    properties(base),
    properties(draft),
    properties(latest),
  )
    .filter(
      (group) =>
        !base.groups.some((original) => original.id === group.id) ||
        latest.groups.some((saved) => saved.id === group.id),
    )
    .map((group) => ({ ...group, links: [] }));
  // A concurrent move or addition must survive deletion of its destination group.
  for (const link of mergedLinks) {
    if (groups.some((group) => group.id === link.groupId)) continue;
    const original = base.groups.find((group) => group.links.some((item) => item.id === link.id));
    let destination = groups.find((group) => group.id === original?.id) ?? groups[0];
    if (!destination) {
      const source = [...latest.groups, ...draft.groups, ...base.groups].find(
        (group) => group.id === link.groupId,
      )!;
      destination = { ...source, links: [] };
      groups.push(destination);
    }
    link.groupId = destination.id;
  }
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
