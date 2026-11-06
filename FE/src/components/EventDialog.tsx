import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { isValidTimeRange } from "@/lib/schedule";
import type { CalendarEvent, CalendarInfo, EventInput } from "@/types/domain";

export const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60";

function newRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  calendars: CalendarInfo[];
  /** Existing event to edit, or defaults for a new one. */
  event?: CalendarEvent | undefined;
  defaults?: Partial<EventInput> | undefined;
}

export function EventDialog({ open, onOpenChange, calendars, event, defaults }: Props) {
  const qc = useQueryClient();
  const uid = useId();
  const writable = calendars.filter((c) => !c.readOnly);
  const eventCal = event ? calendars.find((c) => c.id === event.calendarId) : undefined;
  const readOnly = !!eventCal?.readOnly || !!event?.readOnly;

  const blank = (): EventInput => ({
    calendarId: writable[0]?.id ?? "",
    title: "",
    date: defaults?.date ?? "",
    allDay: false,
    start: "10:00",
    end: "11:00",
    location: "",
    memo: "",
    requestId: newRequestId(),
    ...defaults,
  });
  const [form, setForm] = useState<EventInput>(blank);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset only when the dialog opens — a failed save keeps the user's input.
  useEffect(() => {
    if (open) {
      setForm(event ? { ...event } : blank());
      setError(null);
      setConfirmDelete(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id]);

  const done = () => {
    qc.invalidateQueries({ queryKey: ["schedule"] });
    onOpenChange(false);
  };
  const saveMut = useMutation({
    mutationFn: (input: EventInput) =>
      event ? api.calendar.updateEvent(event.id, input) : api.calendar.createEvent(input),
    onSuccess: done,
    onError: (e) => setError(e instanceof Error ? e.message : "저장하지 못했습니다."),
  });
  const delMut = useMutation({
    mutationFn: () => api.calendar.deleteEvent(event!.id, event?.revision),
    onSuccess: done,
    onError: (e) => setError(e instanceof Error ? e.message : "삭제하지 못했습니다."),
  });

  const set = <K extends keyof EventInput>(k: K, v: EventInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const timeInvalid = !form.allDay && !isValidTimeRange(form.start, form.end);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.title.trim()) return setError("제목을 입력하세요.");
    if (!form.date) return setError("날짜를 선택하세요.");
    if (timeInvalid) return setError("종료 시간은 시작 시간보다 늦어야 합니다.");
    const input = { ...form };
    if (input.allDay) {
      delete input.start;
      delete input.end;
    }
    saveMut.mutate(input);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[94vw] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{readOnly ? "일정 보기" : event ? "일정 수정" : "일정 추가"}</DialogTitle>
          <DialogDescription>
            {readOnly
              ? event?.readOnly
                ? "반복·여러 날·초대 일정은 Apple 캘린더에서 수정하세요."
                : `"${eventCal?.name}"은(는) 읽기 전용 캘린더라 수정할 수 없습니다.`
              : "필수 항목은 제목과 날짜입니다."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="min-w-0 space-y-4" noValidate>
          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
            >
              {error} 입력한 내용은 그대로 남아 있으니 다시 시도하세요.
            </div>
          )}
          <fieldset disabled={readOnly} className="min-w-0 space-y-4">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${uid}-title`}>제목</Label>
              <Input
                id={`${uid}-title`}
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor={`${uid}-cal`}>캘린더</Label>
                <select
                  id={`${uid}-cal`}
                  className={selectClass}
                  value={form.calendarId}
                  onChange={(e) => set("calendarId", e.target.value)}
                >
                  {(readOnly ? calendars : writable).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor={`${uid}-date`}>날짜</Label>
                <Input
                  id={`${uid}-date`}
                  type="date"
                  value={form.date}
                  onChange={(e) => set("date", e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id={`${uid}-allday`}
                checked={form.allDay}
                onCheckedChange={(v) => set("allDay", v)}
              />
              <Label htmlFor={`${uid}-allday`}>종일</Label>
            </div>
            {!form.allDay && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor={`${uid}-start`}>시작</Label>
                  <Input
                    id={`${uid}-start`}
                    type="time"
                    value={form.start ?? ""}
                    onChange={(e) => set("start", e.target.value)}
                  />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor={`${uid}-end`}>종료</Label>
                  <Input
                    id={`${uid}-end`}
                    type="time"
                    value={form.end ?? ""}
                    onChange={(e) => set("end", e.target.value)}
                    aria-invalid={timeInvalid}
                    aria-describedby={timeInvalid ? `${uid}-time-err` : undefined}
                  />
                </div>
                {timeInvalid && (
                  <p id={`${uid}-time-err`} className="col-span-2 text-sm text-destructive">
                    종료 시간이 시작 시간보다 늦어야 합니다.
                  </p>
                )}
              </div>
            )}
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${uid}-loc`}>장소 (선택)</Label>
              <Input
                id={`${uid}-loc`}
                value={form.location ?? ""}
                onChange={(e) => set("location", e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${uid}-memo`}>메모 (선택)</Label>
              <Textarea
                id={`${uid}-memo`}
                rows={2}
                value={form.memo ?? ""}
                onChange={(e) => set("memo", e.target.value)}
              />
            </div>
          </fieldset>
          <DialogFooter className="gap-2 sm:justify-between">
            {event && !readOnly ? (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => delMut.mutate()}
                    disabled={delMut.isPending}
                  >
                    {delMut.isPending ? "삭제 중…" : "정말 삭제"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    취소
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  삭제
                </Button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {readOnly ? "닫기" : "취소"}
              </Button>
              {!readOnly && (
                <Button type="submit" disabled={saveMut.isPending}>
                  {saveMut.isPending ? "저장 중…" : saveMut.isError ? "다시 저장" : "저장"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
