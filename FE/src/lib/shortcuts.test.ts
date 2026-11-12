import { describe, expect, it } from "vitest";
import { moveShortcut, normalizeShortcutUrl } from "./shortcuts";
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
