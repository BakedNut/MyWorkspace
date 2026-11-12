import { afterEach, expect, it, vi } from "vitest";
import { request, restApi } from "./restApi";

afterEach(() => vi.unstubAllGlobals());

it("CSRF 토큰을 전송하고 인증 후에는 새 토큰을 받는다", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "first", headerName: "X-CSRF-TOKEN" })),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: true, expiresAt: "2026-11-07" })),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "second", headerName: "X-CSRF-TOKEN" })),
    )
    .mockResolvedValueOnce(new Response(""));
  vi.stubGlobal("fetch", fetcher);
  await restApi.auth.login("test-password");
  expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
    credentials: "same-origin",
    headers: { "X-CSRF-TOKEN": "first" },
  });
  await restApi.auth.logout();
  expect(fetcher.mock.calls[3]?.[1]).toMatchObject({ headers: { "X-CSRF-TOKEN": "second" } });
});

it("통신 실패를 표시하고 인증 만료 시 화면에 알린다", async () => {
  const handler = vi.fn();
  window.addEventListener("myworkspace:unauthorized", handler);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "로그인이 필요합니다." }), {
          status: 401,
        }),
      )
      .mockRejectedValueOnce(new TypeError("offline")),
  );
  await expect(request("/timetable")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(handler).toHaveBeenCalledOnce();
  await expect(request("/timetable")).rejects.toMatchObject({ code: "NETWORK" });
  window.removeEventListener("myworkspace:unauthorized", handler);
});

it("128KiB를 넘는 유효한 보드는 전송 전에 조정 방법을 안내한다", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const url = "https://example.com/" + "a".repeat(2048 - "https://example.com/".length);
  const input = {
    revision: 1,
    groups: [
      {
        id: "group",
        name: "분류",
        collapsed: false,
        links: Array.from({ length: 64 }, (_, index) => ({
          id: `link-${index}`,
          name: "사이트",
          url,
        })),
      },
    ],
  };
  await expect(restApi.shortcuts.save(input)).rejects.toMatchObject({
    code: "VALIDATION",
    message: expect.stringContaining("긴 URL이나 이름을 줄이거나"),
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it("JSON의 문자 수가 아닌 UTF-8 바이트 수로 요청 한도를 검사한다", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const input = {
    revision: 1,
    groups: [
      {
        id: "group",
        name: "분류",
        collapsed: false,
        links: Array.from({ length: 64 }, (_, index) => ({
          id: `link-${index}`,
          name: "사이트",
          url: "https://example.com/" + "가".repeat(1000),
        })),
      },
    ],
  };
  expect(JSON.stringify(input).length).toBeLessThan(128 * 1024);
  await expect(restApi.shortcuts.save(input)).rejects.toMatchObject({ code: "VALIDATION" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("128KiB 이하 보드는 기존 API로 전송한다", async () => {
  const input = { revision: 1, groups: [] };
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url === "/api/auth/csrf" ? { token: "test", headerName: "X-CSRF-TOKEN" } : input,
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(restApi.shortcuts.save(input)).resolves.toEqual(input);
  expect(fetcher).toHaveBeenCalledWith(
    "/api/shortcuts",
    expect.objectContaining({ method: "PUT", body: JSON.stringify(input) }),
  );
});
