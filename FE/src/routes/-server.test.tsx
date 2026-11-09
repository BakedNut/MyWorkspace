import type { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { sampleServerStatus } from "@/api/mock/seed";
import { Route } from "./server";

const Page = Route.options.component as ComponentType;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each([
  {
    label: "local 있음",
    names: ["disk10", "local", "disk2", "local-lvm", "disk02"],
    sorted: ["local-lvm", "local", "disk02", "disk2", "disk10"],
  },
  {
    label: "local 없음",
    names: ["disk10", "disk2", "local-lvm", "disk02"],
    sorted: ["local-lvm", "disk02", "disk2", "disk10"],
  },
])("$label: 응답 순서와 사용량이 바뀌어도 지정 순서를 유지한다", async ({ names, sorted }) => {
  localStorage.clear();
  const first = {
    ...sampleServerStatus(new Date(), false),
    guests: [],
    storages: names.map((name) => ({ name, usedGb: 10, totalGb: 100, tempC: null })),
  };
  const second = {
    ...first,
    storages: [...first.storages].reverse().map((s) => ({ ...s, usedGb: 80 })),
  };
  Object.freeze(first.storages);
  Object.freeze(second.storages);
  vi.spyOn(api.server, "getStatus").mockResolvedValueOnce(first).mockResolvedValue(second);
  vi.spyOn(api.server, "getHistory").mockResolvedValue({
    from: 0,
    to: 1,
    host: { cpu: [], ram: [], input: [], output: [] },
    guests: {},
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Page />
    </QueryClientProvider>,
  );
  const storage = within(await screen.findByRole("region", { name: "스토리지" }));
  const order = () => storage.getAllByRole("meter").map((e) => e.getAttribute("aria-label"));
  const expected = sorted.map((s) => `${s} 사용률`);
  expect(order()).toEqual(expected);
  fireEvent.click(screen.getByRole("button", { name: "데이터 새로고침" }));
  await waitFor(() =>
    expect(storage.getByRole("meter", { name: "disk2 사용률" })).toHaveAttribute(
      "aria-valuenow",
      "80",
    ),
  );
  expect(order()).toEqual(expected);
  expect(first.storages.map((s) => s.name)).toEqual(names);
  expect(second.storages.map((s) => s.name)).toEqual([...names].reverse());
});
