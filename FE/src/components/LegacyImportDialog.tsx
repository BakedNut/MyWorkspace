import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isPreview } from "@/api";
import { request } from "@/api/restApi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CalendarEvent, Timetable, WolDevice } from "@/types/domain";

function previousData() {
  const read = (key: string) => {
    try {
      return JSON.parse(localStorage.getItem(`myworkspace.mock.v1.${key}`) ?? "null");
    } catch {
      return null;
    }
  };
  const events: CalendarEvent[] = Array.isArray(read("events"))
    ? read("events").filter((e: CalendarEvent) => e.calendarId !== "cal-holiday")
    : [];
  const timetable: Timetable | null = Array.isArray(read("timetable")?.courses)
    ? read("timetable")
    : null;
  const devices: WolDevice[] = Array.isArray(read("wol")) ? read("wol") : [];
  return { events, timetable, devices };
}

export function LegacyImportDialog() {
  const qc = useQueryClient();
  const [data] = useState(previousData);
  const [done, setDone] = useState(() => {
    try {
      return localStorage.getItem("myworkspace.imported.v1") === "true";
    } catch {
      return true;
    }
  });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (isPreview || done || (!data.events.length && !data.timetable && !data.devices.length))
    return null;
  const options = [
    {
      key: "events",
      label: `일정 ${data.events.length}개`,
      detail: data.events.map((e) => e.title).join(", "),
      available: !!data.events.length,
    },
    {
      key: "timetable",
      label: `시간표 ${data.timetable?.courses.length ?? 0}개 수업`,
      detail: data.timetable?.courses.map((c) => c.name).join(", "),
      available: !!data.timetable,
    },
    {
      key: "devices",
      label: `PC ${data.devices.length}대`,
      detail: data.devices.map((d) => d.name).join(", "),
      available: !!data.devices.length,
    },
  ];
  return (
    <>
      <button
        type="button"
        className="min-h-11 text-xs text-muted-foreground underline underline-offset-4"
        onClick={() => setOpen(true)}
      >
        기존 데이터 가져오기
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>기존 데이터 가져오기</DialogTitle>
            <DialogDescription>
              이 브라우저의 시안에서 사용한 데이터입니다. 필요한 항목을 확인해 선택하세요. 서버에
              이미 저장된 항목은 덮어쓰지 않습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {options
              .filter((option) => option.available)
              .map((option) => (
                <label key={option.key} className="flex gap-3 rounded-lg border p-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-primary"
                    disabled={pending}
                    checked={selected.includes(option.key)}
                    onChange={(event) =>
                      setSelected((old) =>
                        event.target.checked
                          ? [...old, option.key]
                          : old.filter((key) => key !== option.key),
                      )
                    }
                  />
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{option.label}</span>
                    <span className="mt-1 block break-words text-xs text-muted-foreground">
                      {option.detail || "비어 있음"}
                    </span>
                  </span>
                </label>
              ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              닫기
            </Button>
            <Button
              disabled={pending || !selected.length}
              onClick={async () => {
                setError("");
                setPending(true);
                try {
                  await request("/import/legacy", "POST", {
                    ...(selected.includes("events")
                      ? {
                          events: data.events.map((e) => ({
                            calendarId: "cal-icloud",
                            title: e.title,
                            date: e.date,
                            allDay: e.allDay,
                            start: e.start,
                            end: e.end,
                            location: e.location,
                            memo: e.memo,
                          })),
                        }
                      : {}),
                    ...(selected.includes("timetable") ? { timetable: data.timetable } : {}),
                    ...(selected.includes("devices") ? { devices: data.devices } : {}),
                  });
                  try {
                    localStorage.setItem("myworkspace.imported.v1", "true");
                  } catch {
                    /* The server already saved the import. */
                  }
                  await qc.invalidateQueries();
                  setDone(true);
                  setOpen(false);
                } catch (failure) {
                  setError(failure instanceof Error ? failure.message : "가져오지 못했습니다.");
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? "가져오는 중…" : "선택한 데이터 가져오기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
