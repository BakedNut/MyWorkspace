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
