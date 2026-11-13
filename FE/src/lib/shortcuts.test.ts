import { describe, expect, it } from "vitest";
import { moveShortcut, normalizeShortcutUrl, reconcileShortcutBoard } from "./shortcuts";
import type { ShortcutBoard } from "@/types/domain";

const board: ShortcutBoard = {
  revision: 3,
  groups: [
    {
      id: "a",
      name: "개발",
      collapsed: false,
      links: [
        { id: "one", name: "첫 번째", url: "https://example.com/one" },
        { id: "two", name: "두 번째", url: "https://example.com/two" },
      ],
    },
    { id: "b", name: "빈 분류", collapsed: true, links: [] },
  ],
};

describe("바로가기 URL", () => {
  it("도메인, 내부망·IPv6·포트와 경로를 보존한다", () => {
    expect(normalizeShortcutUrl(" github.com ")).toBe("https://github.com/");
    expect(normalizeShortcutUrl("http://192.168.1.200:8080/a?q=1#top")).toBe(
      "http://192.168.1.200:8080/a?q=1#top",
    );
    expect(normalizeShortcutUrl("localhost:8080/path")).toBe("https://localhost:8080/path");
    expect(normalizeShortcutUrl("http://[::1]:8080/path")).toBe("http://[::1]:8080/path");
    expect(normalizeShortcutUrl("https://한글.kr/경로")).toContain("xn--");
  });
  it.each([
    "",
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///tmp/test",
    "https://user:password@example.com",
    "https://example.com\n/",
    "https://",
    "https://a.com/" + "a".repeat(2048),
  ])("안전하지 않거나 잘못된 URL을 거부한다 %s", (value) => {
    expect(() => normalizeShortcutUrl(value)).toThrow();
  });
});

describe("바로가기 배치", () => {
  it("같은 분류의 순서를 옮기고 원본을 보존한다", () => {
    const moved = moveShortcut(board, "one", "a", "two");
    expect(moved.groups[0]?.links.map((link) => link.id)).toEqual(["two", "one"]);
    expect(board.groups[0]?.links.map((link) => link.id)).toEqual(["one", "two"]);
    expect(moved.revision).toBe(3);
  });
  it("비어 있고 접힌 분류로 이동할 때 항목을 정확히 한 번 보존한다", () => {
    const moved = moveShortcut(board, "one", "b");
    expect(moved.groups[0]?.links.map((link) => link.id)).toEqual(["two"]);
    expect(moved.groups[1]?.links.map((link) => link.id)).toEqual(["one"]);
    expect(moved.groups[1]?.collapsed).toBe(true);
    expect(moved.groups.flatMap((group) => group.links)).toHaveLength(2);
    expect(moveShortcut(board, "missing", "b")).toBe(board);
  });
});

describe("동시 편집 초안 조정", () => {
  it("로컬 순서·이동·이름 수정과 서버 추가·필드 수정을 함께 보존한다", () => {
    const draft = moveShortcut(structuredClone(board), "two", "b");
    draft.groups[1]!.links[0]!.name = "내 이름";
    const latest = structuredClone(board);
    latest.revision = 8;
    latest.groups[0]!.links[1]!.url = "https://example.com/updated";
    latest.groups[0]!.links.push({ id: "three", name: "추가", url: "https://example.com/3" });
    const result = reconcileShortcutBoard(board, draft, latest);
    expect(result.revision).toBe(8);
    expect(result.groups[0]!.links.map((link) => link.id)).toEqual(["one", "three"]);
    expect(result.groups[1]!.links).toEqual([
      { id: "two", name: "내 이름", url: "https://example.com/updated" },
    ]);
    expect(board.groups[0]!.links).toHaveLength(2);
  });

  it("양쪽의 삭제를 반영하고 수정하지 않은 서버 순서를 보존한다", () => {
    const draft = structuredClone(board);
    draft.groups[0]!.links = draft.groups[0]!.links.filter((link) => link.id !== "one");
    const latest = structuredClone(board);
    latest.groups[0]!.links = latest.groups[0]!.links.filter((link) => link.id !== "two");
    latest.groups.reverse();
    const result = reconcileShortcutBoard(board, draft, latest);
    expect(result.groups.map((group) => group.id)).toEqual(["b", "a"]);
    expect(result.groups.flatMap((group) => group.links)).toEqual([]);
  });

  it("로컬 재정렬 중 서버에서 추가한 항목도 보존한다", () => {
    const draft = moveShortcut(board, "two", "a", "one");
    const latest = structuredClone(board);
    latest.groups[0]!.links.push({ id: "three", name: "추가", url: "https://example.com/3" });
    const result = reconcileShortcutBoard(board, draft, latest);
    expect(result.groups[0]!.links.map((link) => link.id)).toEqual(["two", "one", "three"]);
  });

  it("같은 필드의 충돌은 초안을 우선하고 원격 분류 삭제와 새 분류를 반영한다", () => {
    const draft = structuredClone(board);
    draft.groups[0]!.name = "로컬";
    const latest = structuredClone(board);
    latest.groups[0]!.name = "원격";
    latest.groups.splice(1, 1, { id: "new", name: "새 분류", collapsed: false, links: [] });
    const result = reconcileShortcutBoard(board, draft, latest);
    expect(result.groups.map((group) => group.id)).toEqual(["a", "new"]);
    expect(result.groups[0]!.name).toBe("로컬");
  });
});

it("빈 분류 삭제와 다른 탭의 이동이 겹쳐도 바로가기를 원래 분류에 보존한다", () => {
  const draft = structuredClone(board);
  draft.groups = draft.groups.filter((group) => group.id !== "b");
  const latest = moveShortcut(structuredClone(board), "one", "b");
  latest.revision = 4;
  const result = reconcileShortcutBoard(board, draft, latest);
  expect(result.groups.map((group) => group.id)).toEqual(["a"]);
  expect(result.groups[0]!.links.map((link) => link.id)).toEqual(["two", "one"]);
  expect(new Set(result.groups.flatMap((group) => group.links.map((link) => link.id))).size).toBe(
    2,
  );
});

it("링크 소속 변경만으로 삭제된 분류를 복원하지 않는다", () => {
  const draft = moveShortcut(structuredClone(board), "one", "b");
  const latest = structuredClone(board);
  latest.groups = latest.groups.filter((group) => group.id !== "b");
  const result = reconcileShortcutBoard(board, draft, latest);
  expect(result.groups.map((group) => group.id)).toEqual(["a"]);
  expect(result.groups[0]!.links.map((link) => link.id)).toEqual(["two", "one"]);
});

it("모든 분류 삭제 후에도 새로 추가된 바로가기를 담을 분류를 복원한다", () => {
  const draft = { ...board, groups: [] };
  const latest = structuredClone(board);
  latest.groups[1]!.links.push({ id: "new", name: "새 링크", url: "https://example.com/new" });
  const result = reconcileShortcutBoard(board, draft, latest);
  expect(result.groups).toEqual([
    { ...board.groups[1], links: [{ id: "new", name: "새 링크", url: "https://example.com/new" }] },
  ]);
});

it("원래 분류도 삭제됐다면 새 바로가기를 첫 번째 남은 분류로 보존한다", () => {
  const draft = structuredClone(board);
  draft.groups = [{ id: "remaining", name: "남은 분류", collapsed: false, links: [] }];
  const latest = structuredClone(board);
  latest.groups[1]!.links.push({ id: "new", name: "새 링크", url: "https://example.com/new" });
  const result = reconcileShortcutBoard(board, draft, latest);
  expect(result.groups.map((group) => group.id)).toEqual(["remaining"]);
  expect(result.groups[0]!.links.map((link) => link.id)).toEqual(["new"]);
});

it("서로 다른 바로가기와 분류의 순서 변경을 함께 보존한다", () => {
  const ids = ["a", "b", "c", "d"];
  const base: ShortcutBoard = {
    revision: 1,
    groups: ids.map((id) => ({
      id,
      name: id,
      collapsed: false,
      links: ids.map((link) => ({ id: `${id}-${link}`, name: link, url: "https://example.com/" })),
    })),
  };
  const draft = structuredClone(base);
  [draft.groups[0], draft.groups[1]] = [draft.groups[1]!, draft.groups[0]!];
  const localLinks = draft.groups.find((group) => group.id === "a")!.links;
  [localLinks[0], localLinks[1]] = [localLinks[1]!, localLinks[0]!];
  const latest = structuredClone(base);
  [latest.groups[2], latest.groups[3]] = [latest.groups[3]!, latest.groups[2]!];
  const remoteLinks = latest.groups[0]!.links;
  [remoteLinks[2], remoteLinks[3]] = [remoteLinks[3]!, remoteLinks[2]!];
  latest.revision = 2;
  const result = reconcileShortcutBoard(base, draft, latest);
  expect(result.groups.map((group) => group.id)).toEqual(["b", "a", "d", "c"]);
  expect(result.groups.find((group) => group.id === "a")!.links.map((link) => link.id)).toEqual([
    "a-b",
    "a-a",
    "a-d",
    "a-c",
  ]);
});

it("4개 항목의 모든 편집 조합에서 양쪽이 바꾼 상대 순서를 보존한다", () => {
  const permutations = (ids: string[]): string[][] =>
    ids.length === 0
      ? [[]]
      : ids.flatMap((id) =>
          permutations(ids.filter((item) => item !== id)).map((rest) => [id, ...rest]),
        );
  const ids = ["a", "b", "c", "d"];
  const makeBoard = (order: string[]): ShortcutBoard => ({
    revision: 1,
    groups: order.map((id) => ({ id, name: id, collapsed: false, links: [] })),
  });
  for (const local of permutations(ids)) {
    for (const remote of permutations(ids)) {
      const result = reconcileShortcutBoard(makeBoard(ids), makeBoard(local), makeBoard(remote));
      const order = result.groups.map((group) => group.id);
      for (let first = 0; first < ids.length; first++) {
        for (let second = first + 1; second < ids.length; second++) {
          const a = ids[first]!,
            b = ids[second]!;
          if (local.indexOf(a) > local.indexOf(b) || remote.indexOf(a) > remote.indexOf(b))
            expect(order.indexOf(a)).toBeGreaterThan(order.indexOf(b));
        }
      }
      expect(new Set(order).size).toBe(4);
    }
  }
});

it("새 항목 삽입이 다른 탭에서 이미 바꾼 기존 항목의 상대 순서를 덮어쓰지 않는다", () => {
  const base: ShortcutBoard = {
    revision: 1,
    groups: ["a", "b"].map((id) => ({ id, name: id, collapsed: false, links: [] })),
  };
  const draft = structuredClone(base);
  draft.groups.splice(1, 0, { id: "new", name: "새 분류", collapsed: false, links: [] });
  const latest = structuredClone(base);
  latest.groups.reverse();
  const result = reconcileShortcutBoard(base, draft, latest);
  expect(result.groups.map((group) => group.id)).toEqual(["b", "a", "new"]);
  const inverse = reconcileShortcutBoard(base, latest, draft);
  const ids = inverse.groups.map((group) => group.id);
  expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("a"));
  expect(ids).toContain("new");
});

it("링크를 밖으로 옮긴 분류가 다른 탭에서 삭제되면 빈 분류로 되살리지 않는다", () => {
  const draft = moveShortcut(structuredClone(board), "one", "b");
  const latest = structuredClone(board);
  latest.groups = latest.groups.filter((group) => group.id !== "a");
  latest.revision = 8;
  const result = reconcileShortcutBoard(board, draft, latest);
  expect(result.groups.map((group) => group.id)).toEqual(["b"]);
  expect(result.groups[0]!.links.map((link) => link.id)).toEqual(["one"]);
  expect(result.revision).toBe(8);
});

it("분류 이름 수정만으로 서버에서 삭제한 분류를 복원하지 않는다", () => {
  const draft = structuredClone(board);
  draft.groups[0]!.name = "수정한 이름";
  const latest = structuredClone(board);
  latest.groups = latest.groups.filter((group) => group.id !== "a");
  const result = reconcileShortcutBoard(board, draft, latest);
  expect(result.groups.some((group) => group.id === "a")).toBe(false);
});

it("모든 분류가 삭제됐을 때 남은 새 링크에 필요한 분류 속성만 복원한다", () => {
  const draft = structuredClone(board);
  draft.groups[0]!.name = "수정한 이름";
  draft.groups[0]!.links.push({ id: "new", name: "새 링크", url: "https://example.com/new" });
  const latest: ShortcutBoard = { revision: 8, groups: [] };
  const result = reconcileShortcutBoard(board, draft, latest);
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0]!.name).toBe("수정한 이름");
  expect(result.groups[0]!.links.map((link) => link.id)).toEqual(["new"]);
});

it("분류 삭제로 초안에서 빠진 링크라도 서버에서 다른 분류로 이동했으면 보존한다", () => {
  const draft = structuredClone(board);
  draft.groups = draft.groups.filter((group) => group.id !== "a");
  const latest = moveShortcut(structuredClone(board), "one", "b");
  latest.revision = 4;
  const result = reconcileShortcutBoard(board, draft, latest);
  expect(result.groups.map((group) => group.id)).toEqual(["b"]);
  expect(result.groups[0]!.links.map((link) => link.id)).toEqual(["one"]);
  expect(result.revision).toBe(4);
});

it("개별 삭제한 링크는 같은 분류가 남아 있다면 삭제 의도를 유지한다", () => {
  const draft = structuredClone(board);
  draft.groups[0]!.links = draft.groups[0]!.links.filter((link) => link.id !== "one");
  const latest = moveShortcut(structuredClone(board), "one", "b");
  const result = reconcileShortcutBoard(board, draft, latest);
  expect(result.groups.flatMap((group) => group.links).map((link) => link.id)).toEqual(["two"]);
});

it("이동한 링크의 대상 분류까지 삭제됐다면 남은 분류로 보존한다", () => {
  const draft: ShortcutBoard = {
    revision: board.revision,
    groups: [{ id: "remaining", name: "남은 분류", collapsed: false, links: [] }],
  };
  const latest = moveShortcut(structuredClone(board), "one", "b");
  const result = reconcileShortcutBoard(board, draft, latest);
  expect(result.groups.map((group) => group.id)).toEqual(["remaining"]);
  expect(result.groups[0]!.links.map((link) => link.id)).toEqual(["one"]);
});

it.each([
  ["https://example.com/a[b]", "https://example.com/a%5Bb%5D"],
  ["http://[2001:db8::1]/a[b]", "http://[2001:db8::1]/a%5Bb%5D"],
  ["https://example.com/a%2Fb?x=%5B", "https://example.com/a%2Fb?x=%5B"],
  [
    "https://example.com/%zz?q=[x]|y#x[y]#z",
    "https://example.com/%25zz?q=%5Bx%5D%7Cy#x%5By%5D%23z",
  ],
])("브라우저 URL을 API URI에서도 처리 가능한 형식으로 정규화한다 %s", (input, expected) => {
  expect(normalizeShortcutUrl(input)).toBe(expected);
});

it.each([
  "https://foo_bar/",
  "https://-host/",
  "https://host-/",
  "https://example.1a/",
  "https://foo..bar/",
])("API에서 표현할 수 없는 호스트는 추가 전에 거부한다 %s", (url) => {
  expect(() => normalizeShortcutUrl(url)).toThrow("호스트 주소");
});

it("개별 링크 삭제 후 원래 분류를 삭제해도 개별 삭제 의도를 유지한다", () => {
  const draft: ShortcutBoard = {
    revision: board.revision,
    groups: [structuredClone(board.groups[1]!)],
  };
  const latest = moveShortcut(structuredClone(board), "one", "b");
  latest.revision++;
  const deleted = new Set(["one"]);
  const result = reconcileShortcutBoard(board, draft, latest, deleted);
  expect(result.groups.flatMap((group) => group.links)).toEqual([]);
  const next = moveShortcut(latest, "one", "a");
  next.revision++;
  expect(
    reconcileShortcutBoard(latest, result, next, deleted).groups.flatMap((group) => group.links),
  ).toEqual([]);
});

it.each(["unchanged", "name", "url", "group"])(
  "자동 배치 후 반복 병합은 실제로 편집한 링크만 원격 삭제보다 우선한다 %s",
  (edit) => {
    const base: ShortcutBoard = {
      revision: 1,
      groups: ["a", "b", "c"].map((id) => ({ id, name: id, collapsed: false, links: [] })),
    };
    const draft = structuredClone(base);
    draft.groups.shift();
    const latest = structuredClone(base);
    latest.revision++;
    latest.groups[0]!.links.push({ id: "x", name: "X", url: "https://example.com/X" });
    const placements = new Map<string, string>();
    const merged = reconcileShortcutBoard(base, draft, latest, new Set(), placements);
    expect(placements.get("x")).toBe("b");
    if (edit === "name") merged.groups[0]!.links[0]!.name = "직접 수정";
    if (edit === "url") merged.groups[0]!.links[0]!.url = "https://example.com/edited";
    const local = edit === "group" ? moveShortcut(merged, "x", "c") : merged;
    const removed = structuredClone(latest);
    removed.revision++;
    removed.groups[0]!.links = [];
    const next = reconcileShortcutBoard(latest, local, removed, new Set(), placements);
    expect(next.groups.flatMap((group) => group.links)).toHaveLength(edit === "unchanged" ? 0 : 1);
    expect(placements.size).toBe(0);
  },
);

it("명시적인 이동의 대상이 사라져 자동 배치해도 직접 이동 의도를 유지한다", () => {
  const base: ShortcutBoard = {
    revision: 1,
    groups: ["a", "b", "c"].map((id) => ({ id, name: id, collapsed: false, links: [] })),
  };
  base.groups[0]!.links.push({ id: "x", name: "X", url: "https://example.com/X" });
  const draft = moveShortcut(base, "x", "c");
  draft.groups = draft.groups.filter((group) => group.id !== "a");
  const latest = structuredClone(base);
  latest.groups.pop();
  latest.revision++;
  const placements = new Map<string, string>();
  const merged = reconcileShortcutBoard(base, draft, latest, new Set(), placements);
  expect(merged.groups[0]!.id).toBe("b");
  expect(placements.size).toBe(0);
  const removed = structuredClone(latest);
  removed.groups[0]!.links = [];
  removed.revision++;
  const next = reconcileShortcutBoard(latest, merged, removed, new Set(), placements);
  expect(next.groups[0]!.links[0]!.id).toBe("x");
});

it.each([false, true])(
  "임시 복원한 분류는 삭제 의도를 유지하며 남은 링크에만 필요하다 %s",
  (addLocalLink) => {
    const base: ShortcutBoard = {
      revision: 1,
      groups: [{ id: "a", name: "A", collapsed: false, links: [] }],
    };
    const latest = structuredClone(base);
    latest.revision++;
    latest.groups[0]!.links.push({ id: "x", name: "X", url: "https://example.com/X" });
    const placements = new Map<string, string>();
    const deletedGroups = new Set(["a"]);
    const restored = reconcileShortcutBoard(
      base,
      { ...base, groups: [] },
      latest,
      new Set(),
      placements,
      deletedGroups,
    );
    expect(restored.groups[0]!.links[0]!.id).toBe("x");
    if (addLocalLink)
      restored.groups[0]!.links.push({ id: "y", name: "Y", url: "https://example.com/Y" });
    const removed = structuredClone(latest);
    removed.revision++;
    removed.groups[0]!.links = [];
    const next = reconcileShortcutBoard(
      latest,
      restored,
      removed,
      new Set(),
      placements,
      deletedGroups,
    );
    expect(next.groups).toHaveLength(addLocalLink ? 1 : 0);
    if (addLocalLink) expect(next.groups[0]!.links.map((link) => link.id)).toEqual(["y"]);
  },
);

it.each([false, true])(
  "임시 복원 분류에서 뒤늦게 원격 이동한 링크도 개별 삭제 의도에 따라 처리한다 %s",
  (explicitDelete) => {
    const x = { id: "x", name: "X", url: "https://example.com/X" };
    const y = { id: "y", name: "Y", url: "https://example.com/Y" };
    const base: ShortcutBoard = {
      revision: 1,
      groups: [{ id: "a", name: "A", collapsed: false, links: [x] }],
    };
    const latest = structuredClone(base);
    latest.revision++;
    latest.groups[0]!.links.push(y);
    const placements = new Map<string, string>();
    const deletedLinks = new Set(explicitDelete ? ["x"] : []);
    const deletedGroups = new Set(["a"]);
    const restored = reconcileShortcutBoard(
      base,
      { ...base, groups: [] },
      latest,
      deletedLinks,
      placements,
      deletedGroups,
    );
    expect(restored.groups[0]!.id).toBe("a");
    expect(restored.groups[0]!.links.map((link) => link.id)).toEqual(["y"]);
    const moved: ShortcutBoard = {
      revision: 3,
      groups: [
        { ...latest.groups[0]!, links: [y] },
        { id: "b", name: "B", collapsed: false, links: [{ ...x, name: "원격 수정 X" }] },
      ],
    };
    const merged = reconcileShortcutBoard(
      latest,
      restored,
      moved,
      deletedLinks,
      placements,
      deletedGroups,
    );
    expect(merged.groups.map((group) => group.id)).toEqual(["b"]);
    expect(merged.groups[0]!.links.map((link) => link.id).sort()).toEqual(
      explicitDelete ? ["y"] : ["x", "y"],
    );
    if (!explicitDelete)
      expect(merged.groups[0]!.links.find((link) => link.id === "x")!.name).toBe("원격 수정 X");
    const removedY: ShortcutBoard = { ...structuredClone(moved), revision: 4 };
    removedY.groups[0]!.links = [];
    const final = reconcileShortcutBoard(
      moved,
      merged,
      removedY,
      deletedLinks,
      placements,
      deletedGroups,
    );
    expect(final.groups.map((group) => group.id)).toEqual(["b"]);
    expect(final.groups[0]!.links.map((link) => link.id)).toEqual(explicitDelete ? [] : ["x"]);
  },
);
