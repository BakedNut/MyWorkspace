import type {
  BootState,
  CalendarEvent,
  CalendarInfo,
  DateKey,
  EventInput,
  ICloudStatus,
  ServerStatus,
  Session,
  Timetable,
  TodayItem,
  WakeResult,
  WolDevice,
  WolDeviceId,
} from "@/types/domain";

/**
 * The contract between the UI and the backend.
 * Each group maps to a Spring Boot REST controller:
 *   auth      -> /api/auth
 *   today     -> /api/today
 *   calendar  -> /api/calendar
 *   timetable -> /api/timetable
 *   server    -> /api/server
 *   wol       -> /api/wol/devices
 *
 * Today only `mockApi` implements it. A future `restApi` (fetch-based) must
 * implement the same interface, then swap it in src/api/index.ts.
 */
export interface ApiClient {
  auth: {
    login(password: string): Promise<Session>;
    logout(): Promise<void>;
    getSession(): Promise<Session | null>;
  };
  today: {
    get(date: DateKey): Promise<TodayItem[]>;
  };
  calendar: {
    listCalendars(): Promise<CalendarInfo[]>;
    listEvents(range: { from: DateKey; to: DateKey }): Promise<CalendarEvent[]>;
    createEvent(input: EventInput): Promise<CalendarEvent>;
    updateEvent(id: string, input: EventInput): Promise<CalendarEvent>;
    deleteEvent(id: string): Promise<void>;
    getICloudStatus(): Promise<ICloudStatus>;
  };
  timetable: {
    get(): Promise<Timetable>;
    save(t: Timetable): Promise<Timetable>;
  };
  server: {
    getStatus(): Promise<ServerStatus>;
  };
  wol: {
    list(): Promise<WolDevice[]>;
    updateMac(id: WolDeviceId, mac: string | null): Promise<WolDevice>;
    wake(id: WolDeviceId): Promise<WakeResult>;
    getBootState(id: WolDeviceId): Promise<BootState>;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      "UNAUTHORIZED" | "RATE_LIMITED" | "VALIDATION" | "READ_ONLY" | "NETWORK" | "NOT_FOUND",
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}
