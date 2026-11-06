import type {
  CalendarEvent,
  CalendarInfo,
  ServerStatus,
  Timetable,
  WolDevice,
} from "@/types/domain";
import { addDays, todayKey, weekday } from "@/lib/time";

// All demo data is generated relative to the current Asia/Seoul date.

export const seedCalendars = (): CalendarInfo[] => [
  { id: "cal-icloud", name: "iCloud 개인", source: "icloud", color: "icloud", readOnly: false },
  { id: "cal-local", name: "내 일정", source: "local", color: "personal", readOnly: false },
  { id: "cal-holiday", name: "공휴일 (예시)", source: "holiday", color: "holiday", readOnly: true },
];

export const seedEvents = (): CalendarEvent[] => {
  const t = todayKey();
  return [
    {
      id: "e1",
      calendarId: "cal-icloud",
      title: "프로젝트 회의",
      date: t,
      allDay: false,
      start: "15:00",
      end: "16:00",
      location: "온라인",
    },
    {
      id: "e2",
      calendarId: "cal-icloud",
      title: "운동",
      date: t,
      allDay: false,
      start: "18:30",
      end: "19:30",
    },
    { id: "e3", calendarId: "cal-local", title: "가족 저녁", date: addDays(t, 2), allDay: true },
    {
      id: "e4",
      calendarId: "cal-icloud",
      title: "치과 예약",
      date: addDays(t, 5),
      allDay: false,
      start: "14:00",
      end: "15:00",
    },
    {
      id: "e5",
      calendarId: "cal-holiday",
      title: "기념일 (예시)",
      date: addDays(t, 10),
      allDay: true,
    },
  ];
};

export const seedTimetable = (): Timetable => {
  const t = todayKey();
  const wd = weekday(t);
  const other = (wd + 3) % 7;
  return {
    semesterStart: addDays(t, -60),
    semesterEnd: addDays(t, 60),
    courses: [
      {
        id: "c1",
        name: "운영체제",
        room: "공학관 302",
        weekday: wd,
        start: "09:00",
        end: "10:15",
        cancelledDates: [],
      },
      {
        id: "c2",
        name: "데이터베이스",
        room: "공학관 201",
        weekday: wd,
        start: "11:00",
        end: "12:15",
        cancelledDates: [],
      },
      {
        id: "c3",
        name: "컴퓨터구조",
        room: "공학관 301",
        weekday: other,
        start: "09:00",
        end: "10:15",
        cancelledDates: [],
      },
      {
        id: "c4",
        name: "알고리즘",
        room: "공학관 203",
        weekday: other,
        start: "11:00",
        end: "12:15",
        cancelledDates: [],
      },
    ],
  };
};

export const seedWolDevices = (): WolDevice[] => [
  { id: "my-pc", name: "내 PC", mac: null },
  { id: "brother-pc", name: "형 PC", mac: null },
];

export const sampleServerStatus = (updatedAt: Date, withTemps: boolean): ServerStatus => ({
  hostName: "home-server (샘플)",
  updatedAt: updatedAt.toISOString(),
  cpu: { usagePercent: 23, cores: 8, tempC: withTemps ? 48 : null },
  ram: { usedMb: 21_340, totalMb: 32_768 },
  storages: [
    { name: "local-nvme (OS)", usedGb: 118, totalGb: 476, tempC: withTemps ? 41 : null },
    { name: "data-hdd", usedGb: 2_870, totalGb: 3_726, tempC: withTemps ? 36 : null },
    { name: "backup-hdd", usedGb: 912, totalGb: 1_863, tempC: null },
  ],
  guests: [
    {
      id: 100,
      name: "media-vm",
      type: "vm",
      status: "running",
      cpuPercent: 12,
      memUsedMb: 3_100,
      memTotalMb: 4_096,
    },
    {
      id: 101,
      name: "dev-vm",
      type: "vm",
      status: "stopped",
      cpuPercent: 0,
      memUsedMb: 0,
      memTotalMb: 8_192,
    },
    {
      id: 200,
      name: "nginx-proxy",
      type: "lxc",
      status: "running",
      cpuPercent: 2,
      memUsedMb: 180,
      memTotalMb: 512,
    },
    {
      id: 201,
      name: "db-lxc",
      type: "lxc",
      status: "running",
      cpuPercent: 6,
      memUsedMb: 1_450,
      memTotalMb: 2_048,
    },
    {
      id: 202,
      name: "backup-lxc",
      type: "lxc",
      status: "paused",
      cpuPercent: 0,
      memUsedMb: 220,
      memTotalMb: 1_024,
    },
  ],
});
