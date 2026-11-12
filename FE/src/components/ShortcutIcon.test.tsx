import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { ShortcutIcon } from "./ShortcutIcon";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const link = { id: "github", name: "GitHub", url: "https://github.com/" };

it("아이콘을 불러오는 중과 실패 시 사슬 아이콘을 표시한다", () => {
  vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue("/api/shortcuts/icons/github");
  const { container } = render(<ShortcutIcon link={link} />);
  const image = container.querySelector("img")!;
  expect(container.querySelector("svg")).toBeInTheDocument();
  fireEvent.error(image);
  expect(container.querySelector("img")).not.toBeInTheDocument();
  expect(container.querySelector("svg")).toBeInTheDocument();
});

it("저장된 아이콘이 로드되면 사슬 아이콘을 대신한다", () => {
  vi.spyOn(api.shortcuts, "iconUrl").mockReturnValue("/api/shortcuts/icons/github");
  const { container } = render(<ShortcutIcon link={link} />);
  fireEvent.load(container.querySelector("img")!);
  expect(container.querySelector("svg")).not.toBeInTheDocument();
  expect(container.querySelector("img")).not.toHaveClass("opacity-0");
});

it("URL 변경 시 새 사이트의 아이콘을 다시 불러온다", () => {
  vi.spyOn(api.shortcuts, "iconUrl").mockImplementation(
    (link) => `/api/shortcuts/icons/${link.id}?site=${new URL(link.url).origin}`,
  );
  const { container, rerender } = render(<ShortcutIcon key={link.url} link={link} />);
  fireEvent.load(container.querySelector("img")!);
  const changed = { ...link, url: "https://react.dev/" };
  rerender(<ShortcutIcon key={changed.url} link={changed} />);
  expect(container.querySelector("svg")).toBeInTheDocument();
  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    "/api/shortcuts/icons/github?site=https://react.dev",
  );
});
