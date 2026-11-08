import type { ApiClient } from "../client";
import { ApiError } from "../client";
import type {
  CalendarEvent,
  CalendarInfo,
  EventInput,
  Timetable,
  TodayItem,
  WolDevice,
  WolDeviceId,
} from "@/types/domain";
import { expandTimetable, isValidTimeRange } from "@/lib/schedule";
import { validateTimetable } from "@/lib/timetable";
import { cooldownRemaining, normalizeMac, normalizeWolList } from "@/lib/wol";
import { delay, load, remove, save } from "./storage";
import { sampleServerHistory } from "./server-history";
import {
  sampleServerStatus,
  seedCalendars,
  seedEvents,
  seedTimetable,
  seedWolDevices,
} from "./seed";

/* ------------------------------------------------------------------ */
/* Demo-only controls (scenario switches). Not part of ApiClient and   */
/* must be removed when the REST adapter replaces the mock.            */
/* ------------------------------------------------------------------ */
export type ServerScenario = "normal" | "loading" | "error" | "stale" | "noTemp";
interface MockControls {
  simulateSaveFailure: boolean;
  serverScenario: ServerScenario;
}
const controls = (): MockControls =>
  load("controls", () => ({ simulateSaveFailure: false, serverScenario: "normal" }));
export const mockControls = {
  get: controls,
  set(patch: Partial<MockControls>) {
    save("controls", { ...controls(), ...patch });
  },
};

/**
 * MOCK PASSWORD — demo only, intentionally public.
 * In production the password check, session cookie (HttpOnly) and any trusted-IP
 * policy are enforced by the Spring Boot server. The frontend never decides trust
 * on its own and contains no IP-based bypass.
 */
export const MOCK_PASSWORD = "demo";

const SESSION_KEY = "session";
const uid = () => Math.random().toString(36).slice(2, 10);

const calendars = () =>
  load<CalendarInfo[]>("calendars", seedCalendars)
    .filter((c) => c.source !== "local")
    .map((c) => (c.name === "iCloud 개인" ? { ...c, name: "iCloud" } : c));
// Retiring the local calendar must not discard events saved by earlier previews.
const events = () =>
  load<CalendarEvent[]>("events", seedEvents).map((e) =>
    e.calendarId === "cal-local" ? { ...e, calendarId: "cal-icloud" } : e,
  );
const timetable = () => load<Timetable>("timetable", seedTimetable);
const devices = () => load<WolDevice[]>("wol", seedWolDevices);

function validateEvent(input: EventInput) {
  const cal = calendars().find((c) => c.id === input.calendarId);
  if (!cal) throw new ApiError("캘린더를 찾을 수 없습니다.", "NOT_FOUND");
  if (cal.readOnly) throw new ApiError("읽기 전용 캘린더에는 저장할 수 없습니다.", "READ_ONLY");
  if (!input.title.trim()) throw new ApiError("제목을 입력하세요.", "VALIDATION");
  if (!input.allDay && !isValidTimeRange(input.start, input.end))
    throw new ApiError("종료 시간은 시작 시간보다 늦어야 합니다.", "VALIDATION");
  if (controls().simulateSaveFailure)
    throw new ApiError("서버에 저장하지 못했습니다. (실패 시뮬레이션)", "NETWORK");
}

// In-memory rate limit (the real server enforces its own limit).
const lastWake = new Map<WolDeviceId, number>();

export const mockApi: ApiClient = {
  security: {
    async getStatus() {
      return {
        otpEnabled: false,
        passwordChanged: false,
        requiresHttps: false,
        secureSetupUrl: null,
      };
    },
    async changePassword() {
      throw new ApiError("암호 설정은 실제 서비스에서 진행하세요.", "READ_ONLY");
    },
    async beginOtp() {
      throw new ApiError("암호 설정은 실제 서비스에서 진행하세요.", "READ_ONLY");
    },
    async confirmOtp() {
      throw new ApiError("암호 설정은 실제 서비스에서 진행하세요.", "READ_ONLY");
    },
    async disableOtp() {
      throw new ApiError("암호 설정은 실제 서비스에서 진행하세요.", "READ_ONLY");
    },
  },
  auth: {
    async login(password) {
      await delay(400);
      if (password !== MOCK_PASSWORD)
        throw new ApiError("비밀번호가 올바르지 않습니다.", "UNAUTHORIZED");
      const session = {
        authenticated: true as const,
        expiresAt: new Date(Date.now() + 12 * 3600_000).toISOString(),
      };
      save(SESSION_KEY, session);
      return session;
    },
    async logout() {
      remove(SESSION_KEY);
    },
    async getSession() {
      const s = load<{ authenticated: true; expiresAt: string } | null>(SESSION_KEY, () => null);
      if (!s || new Date(s.expiresAt).getTime() < Date.now()) return null;
      return s;
    },
  },

  today: {
    async get(date) {
      await delay(150);
      const cals = calendars();
      const classes: TodayItem[] = expandTimetable(timetable(), date, date).map((c) => ({
        kind: "class",
        id: `${c.courseId}-${c.date}-${c.start}`,
        title: c.name,
        start: c.start,
        end: c.end,
        room: c.room,
      }));
      const evs: TodayItem[] = events()
        .filter((e) => e.date === date)
        .map((e) => ({
          kind: "event",
          id: e.id,
          event: e,
          calendar: cals.find((c) => c.id === e.calendarId)!,
        }));
      const startOf = (i: TodayItem) =>
        i.kind === "class" ? i.start : i.event.allDay ? "00:00" : i.event.start!;
      return [...classes, ...evs].sort((a, b) => startOf(a).localeCompare(startOf(b)));
    },
  },

  calendar: {
    async discoverICloud() {
      throw new ApiError("iCloud 연결은 실제 서비스에서 진행하세요.", "READ_ONLY");
    },
    async connectICloud() {
      throw new ApiError("iCloud 연결은 실제 서비스에서 진행하세요.", "READ_ONLY");
    },
    async syncICloud() {
      throw new ApiError("iCloud 연결은 실제 서비스에서 진행하세요.", "READ_ONLY");
    },
    async disconnectICloud() {
      throw new ApiError("iCloud 연결은 실제 서비스에서 진행하세요.", "READ_ONLY");
    },
    async listCalendars() {
      await delay(100);
      return calendars();
    },
    async listEvents({ from, to }) {
      await delay(150);
      return events().filter((e) => e.date >= from && e.date <= to);
    },
    async createEvent(input) {
      await delay(300);
      validateEvent(input);
      const ev = { ...input, id: uid() };
      save("events", [...events(), ev]);
      return ev;
    },
    async updateEvent(id, input) {
      await delay(300);
      const existing = events().find((e) => e.id === id);
      if (!existing) throw new ApiError("일정을 찾을 수 없습니다.", "NOT_FOUND");
      if (calendars().find((c) => c.id === existing.calendarId)?.readOnly)
        throw new ApiError("읽기 전용 일정입니다.", "READ_ONLY");
      validateEvent(input);
      const ev = { ...input, id };
      save(
        "events",
        events().map((e) => (e.id === id ? ev : e)),
      );
      return ev;
    },
    async deleteEvent(id) {
      await delay(250);
      const existing = events().find((e) => e.id === id);
      if (existing && calendars().find((c) => c.id === existing.calendarId)?.readOnly)
        throw new ApiError("읽기 전용 일정입니다.", "READ_ONLY");
      if (controls().simulateSaveFailure)
        throw new ApiError("삭제하지 못했습니다. (실패 시뮬레이션)", "NETWORK");
      save(
        "events",
        events().filter((e) => e.id !== id),
      );
    },
    async getICloudStatus() {
      await delay(100);
      return {
        mode: "demo",
        state: "connected",
        lastSyncedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
      };
    },
  },

  timetable: {
    async get() {
      await delay(100);
      return timetable();
    },
    async save(t) {
      await delay(300);
      const issue = validateTimetable(t);
      if (issue) throw new ApiError(issue.message, "VALIDATION");
      if (controls().simulateSaveFailure)
        throw new ApiError("시간표를 저장하지 못했습니다. (실패 시뮬레이션)", "NETWORK");
      save("timetable", t);
      return t;
    },
  },

  server: {
    async getHistory(range) {
      const scenario = controls().serverScenario;
      if (scenario === "loading") return new Promise(() => {});
      await delay(200);
      if (scenario === "error") throw new ApiError("사용률 기록을 불러오지 못했습니다.", "NETWORK");
      return sampleServerHistory(range, Date.now() - (scenario === "stale" ? 12 * 60_000 : 0));
    },
    async getStatus() {
      const scenario = controls().serverScenario;
      if (scenario === "loading") return new Promise(() => {}); // never resolves
      await delay(400);
      if (scenario === "error")
        throw new ApiError("서버 모니터링 API에 연결하지 못했습니다.", "NETWORK");
      if (scenario === "stale") return sampleServerStatus(new Date(Date.now() - 12 * 60_000), true);
      return sampleServerStatus(new Date(), scenario !== "noTemp");
    },
  },

  wol: {
    async saveDevices(next) {
      await delay(200);
      let normalized: WolDevice[];
      try {
        normalized = normalizeWolList(next);
      } catch (error) {
        throw new ApiError(
          error instanceof Error ? error.message : "PC 목록을 확인하세요.",
          "VALIDATION",
        );
      }
      if (controls().simulateSaveFailure)
        throw new ApiError("PC 목록을 저장하지 못했습니다.", "NETWORK");
      save("wol", normalized);
      for (const id of lastWake.keys())
        if (!normalized.some((d) => d.id === id)) lastWake.delete(id);
      return normalized;
    },
    async list() {
      await delay(100);
      return devices();
    },
    async updateMac(id, mac) {
      await delay(200);
      const normalized = mac === null ? null : normalizeMac(mac);
      if (mac !== null && !normalized)
        throw new ApiError("올바른 MAC 주소가 아닙니다.", "VALIDATION");
      const next = devices().map((d) => (d.id === id ? { ...d, mac: normalized } : d));
      save("wol", next);
      return next.find((d) => d.id === id)!;
    },
    async wake(id) {
      await delay(300);
      const dev = devices().find((d) => d.id === id);
      if (!dev?.mac) throw new ApiError("MAC 주소가 등록되지 않았습니다.", "VALIDATION");
      const remaining = cooldownRemaining(lastWake.get(id) ?? null, Date.now());
      if (remaining > 0) throw new ApiError("잠시 후 다시 시도하세요.", "RATE_LIMITED", remaining);
      lastWake.set(id, Date.now());
      return { sentAt: new Date().toISOString() };
    },
  },
};
