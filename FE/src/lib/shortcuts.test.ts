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
    expect(result.groups[0]!.links.map((link) => link.id)).toEqual(["two", "three", "one"]);
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
