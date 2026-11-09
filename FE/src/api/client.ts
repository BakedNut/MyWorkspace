import type {
  CalendarEvent,
  CalendarInfo,
  DateKey,
  EventInput,
  ICloudStatus,
  ICloudDiscovery,
  ServerStatus,
  ServerHistory,
  ServerRange,
  Session,
  SiteSettings,
  SecurityStatus,
  SecurityProof,
  PasswordChange,
  OtpSetup,
  Timetable,
  TodayItem,
  WakeResult,
  WolDevice,
  WolDeviceId,
} from "@/types/domain";

/**
 * The contract between the UI and the backend.
 * Each group maps to a Spring Boot REST controller:
 *   site      -> /api/site
 *   auth      -> /api/auth
 *   today     -> /api/today
 *   calendar  -> /api/calendar
 *   timetable -> /api/timetable
 *   server    -> /api/server
 *   wol       -> /api/wol/devices
 *
 * `restApi` implements the live service; `mockApi` is for previews and unit tests.
 */
export interface ApiClient {
  site: {
    get(): Promise<SiteSettings>;
    save(input: SiteSettings): Promise<SiteSettings>;
  };
  security: {
    getStatus(): Promise<SecurityStatus>;
    changePassword(input: PasswordChange): Promise<void>;
    beginOtp(currentPassword: string): Promise<OtpSetup>;
    confirmOtp(setupToken: string, code: string): Promise<void>;
    disableOtp(input: SecurityProof): Promise<void>;
  };
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
    deleteEvent(id: string, revision?: string): Promise<void>;
    getICloudStatus(): Promise<ICloudStatus>;
    discoverICloud(input: { appleId: string; appPassword: string }): Promise<ICloudDiscovery>;
    connectICloud(draftToken: string, calendarId: string): Promise<ICloudStatus>;
    syncICloud(): Promise<ICloudStatus>;
    disconnectICloud(): Promise<void>;
  };
  timetable: {
    get(): Promise<Timetable>;
    save(t: Timetable): Promise<Timetable>;
  };
  server: {
    getStatus(): Promise<ServerStatus>;
    getHistory(range: ServerRange): Promise<ServerHistory>;
  };
  wol: {
    list(): Promise<WolDevice[]>;
    saveDevices(devices: WolDevice[]): Promise<WolDevice[]>;
    updateMac(id: WolDeviceId, mac: string | null): Promise<WolDevice>;
    wake(id: WolDeviceId): Promise<WakeResult>;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "UNAUTHORIZED"
      | "RATE_LIMITED"
      | "VALIDATION"
      | "READ_ONLY"
      | "NETWORK"
      | "NOT_FOUND"
      | "CONFLICT",
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}
