import type { ApiClient } from "./client";
import { ApiError } from "./client";
import type { BootState } from "@/types/domain";

let csrf: { token: string; headerName: string } | null = null;
async function token() {
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  if (!response.ok) throw new ApiError("서버에 연결하지 못했습니다.", "NETWORK");
  csrf = await response.json();
  return csrf!;
}

export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  retry = true,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  try {
    const headers: Record<string, string> = { Accept: "application/json", ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET") {
      const value = csrf ?? (await token());
      headers[value.headerName] = value.token;
    }
    const response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: "same-origin",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    const value = text ? JSON.parse(text) : null;
    if (response.status === 403 && value?.code === "CSRF" && retry) {
      csrf = null;
      return request<T>(path, method, body, false, extraHeaders);
    }
    if (!response.ok) {
      if (response.status === 401 && path !== "/auth/login")
        window.dispatchEvent(new Event("myworkspace:unauthorized"));
      throw new ApiError(
        value?.message ?? "요청을 처리하지 못했습니다.",
        value?.code ?? "NETWORK",
        value?.retryAfterMs,
      );
    }
    return value as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.", "NETWORK");
  }
}

export const restApi: ApiClient = {
  auth: {
    getSession: () => request("/auth/session"),
    async login(password) {
      const session = await request<Awaited<ReturnType<ApiClient["auth"]["login"]>>>(
        "/auth/login",
        "POST",
        { password },
      );
      csrf = null;
      return session;
    },
    async logout() {
      await request("/auth/logout", "POST");
      csrf = null;
    },
  },
  today: { get: (date) => request(`/today?date=${encodeURIComponent(date)}`) },
  calendar: {
    listCalendars: () => request("/calendar/calendars"),
    listEvents: ({ from, to }) =>
      request(`/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    createEvent: (input) => request("/calendar/events", "POST", input),
    updateEvent: (id, input) => request(`/calendar/events/${encodeURIComponent(id)}`, "PUT", input),
    deleteEvent: (id, revision) =>
      request(
        `/calendar/events/${encodeURIComponent(id)}`,
        "DELETE",
        undefined,
        true,
        revision ? { "If-Match": revision } : {},
      ),
    getICloudStatus: () => request("/calendar/icloud/status"),
    discoverICloud: (input) => request("/calendar/icloud/discover", "POST", input),
    connectICloud: (draftToken, calendarId) =>
      request("/calendar/icloud/connect", "POST", { draftToken, calendarId }),
    syncICloud: () => request("/calendar/icloud/sync", "POST"),
    disconnectICloud: () => request("/calendar/icloud", "DELETE"),
  },
  timetable: {
    get: () => request("/timetable"),
    save: (input) => request("/timetable", "PUT", input),
  },
  server: {
    getStatus: () => request("/server/status"),
    getHistory: (range) => request(`/server/history?range=${encodeURIComponent(range)}`),
  },
  wol: {
    list: () => request("/wol/devices"),
    saveDevices: (devices) => request("/wol/devices", "PUT", devices),
    updateMac: (id, mac) => request(`/wol/devices/${encodeURIComponent(id)}/mac`, "PATCH", { mac }),
    wake: (id) => request(`/wol/devices/${encodeURIComponent(id)}/wake`, "POST"),
    getBootState: async (id) =>
      (await request<{ state: BootState }>(`/wol/devices/${encodeURIComponent(id)}/boot`)).state,
  },
};
