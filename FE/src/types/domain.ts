/**
 * Domain types shared by the UI and the API layer.
 * These mirror the JSON DTOs the Spring Boot backend is expected to return.
 * Dates are "YYYY-MM-DD" strings and times are "HH:mm" strings, both in Asia/Seoul.
 */

export type DateKey = string; // YYYY-MM-DD (Asia/Seoul)
export type TimeHM = string; // HH:mm (24h)

// ---------- /api/auth ----------
export interface Session {
  authenticated: true;
  expiresAt: string; // ISO
}

// ---------- /api/calendar ----------
export type CalendarSource = "icloud" | "local" | "holiday";
export type CalendarColor = "icloud" | "personal" | "holiday" | "school";

export interface CalendarInfo {
  id: string;
  name: string;
  source: CalendarSource;
  color: CalendarColor;
  readOnly: boolean;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  date: DateKey;
  allDay: boolean;
  start?: TimeHM;
  end?: TimeHM;
  location?: string;
  memo?: string;
}

export type EventInput = Omit<CalendarEvent, "id">;

export interface ICloudStatus {
  /** Always "demo" in the mock — no real iCloud connection exists yet. */
  mode: "demo";
  state: "connected" | "disconnected" | "error";
  lastSyncedAt: string | null; // ISO
}

// ---------- /api/timetable ----------
export interface Course {
  id: string;
  name: string;
  room: string;
  professor?: string;
  weekday: number; // 0 = 일요일 ... 6 = 토요일
  start: TimeHM;
  end: TimeHM;
  cancelledDates: DateKey[]; // 휴강일
}

export interface Timetable {
  semesterStart: DateKey;
  semesterEnd: DateKey;
  courses: Course[];
}

export interface ClassOccurrence {
  courseId: string;
  name: string;
  room: string;
  date: DateKey;
  start: TimeHM;
  end: TimeHM;
}

// ---------- /api/today ----------
export type TodayItem =
  | { kind: "class"; id: string; title: string; start: TimeHM; end: TimeHM; room: string }
  | { kind: "event"; id: string; event: CalendarEvent; calendar: CalendarInfo };

// ---------- /api/server ----------
export interface StorageUsage {
  name: string;
  usedGb: number;
  totalGb: number;
  tempC: number | null; // null = sensor not supported
}

export interface NetworkUsage {
  inputBytesPerSecond: number;
  outputBytesPerSecond: number;
}

export interface GuestStatus {
  id: number;
  name: string;
  type: "vm" | "lxc";
  status: "running" | "stopped" | "paused";
  cpuPercent: number;
  memUsedMb: number;
  memTotalMb: number;
  network: NetworkUsage;
  disk: { usedGb: number | null; totalGb: number }; // null when guest filesystem usage is unavailable
}

export interface ServerStatus {
  hostName: string;
  updatedAt: string; // ISO
  cpu: { usagePercent: number; cores: number; tempC: number | null };
  ram: { usedMb: number; totalMb: number };
  network: NetworkUsage;
  storages: StorageUsage[];
  guests: GuestStatus[];
}

export type ServerRange = "1m" | "15m" | "1D" | "1W" | "1M";
export interface UsagePoint {
  at: number;
  value: number | null;
}
export interface ResourceHistory {
  cpu: UsagePoint[];
  ram: UsagePoint[];
  input: UsagePoint[]; // bytes per second, not cumulative bytes
  output: UsagePoint[];
}

export interface ServerHistory {
  from: number;
  to: number;
  host: ResourceHistory;
  guests: Record<string, ResourceHistory & { disk: UsagePoint[] }>;
}

// ---------- /api/wol/devices ----------
export type WolDeviceId = string;

export interface WolDevice {
  id: WolDeviceId;
  name: string;
  mac: string | null; // null = 미등록
}

export interface WakeResult {
  sentAt: string; // ISO — magic packet sent (does NOT mean booted)
}

export type BootState = "online" | "offline" | "unknown";
