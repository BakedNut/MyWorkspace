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
