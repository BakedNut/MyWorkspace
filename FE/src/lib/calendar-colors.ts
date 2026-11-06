import type { CalendarColor, CalendarSource } from "@/types/domain";

// Literal class strings so Tailwind can see them.
export const colorClasses: Record<CalendarColor, { dot: string; chip: string; text: string }> = {
  school: {
    dot: "bg-cal-school",
    chip: "bg-cal-school-soft text-cal-school",
    text: "text-cal-school",
  },
  icloud: {
    dot: "bg-cal-icloud",
    chip: "bg-cal-icloud-soft text-cal-icloud",
    text: "text-cal-icloud",
  },
  personal: {
    dot: "bg-cal-personal",
    chip: "bg-cal-personal-soft text-cal-personal",
    text: "text-cal-personal",
  },
  holiday: {
    dot: "bg-cal-holiday",
    chip: "bg-cal-holiday-soft text-cal-holiday",
    text: "text-cal-holiday",
  },
};

export const sourceLabel: Record<CalendarSource | "school", string> = {
  icloud: "iCloud",
  local: "로컬",
  holiday: "구독",
  school: "학교",
};
