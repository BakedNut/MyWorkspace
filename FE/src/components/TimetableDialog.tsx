import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
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
import { WEEKDAYS, formatShort } from "@/lib/time";
import type { Course, Timetable } from "@/types/domain";
import { selectClass } from "./EventDialog";

export function TimetableDialog({
  open,
  onOpenChange,
  timetable,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  timetable?: Timetable | undefined;
}) {
  const qc = useQueryClient();
  const uid = useId();
  const [form, setForm] = useState<Timetable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && timetable) {
      setForm(structuredClone(timetable));
      setError(null);
    }
  }, [open, timetable]);

  const mut = useMutation({
    mutationFn: (t: Timetable) => api.timetable.save(t),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule"] });
      onOpenChange(false);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "저장하지 못했습니다."),
  });

  if (!form) return null;
  const updateCourse = (id: string, patch: Partial<Course>) =>
    setForm(
      (f) => f && { ...f, courses: f.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)) },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>학교 시간표 설정</DialogTitle>
          <DialogDescription>
            학기 기간 안의 요일에 맞춰 수업이 캘린더와 메인에 표시됩니다. 휴강일에는 표시되지
            않습니다.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mut.mutate(form);
          }}
          className="space-y-6"
        >
          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
            >
              {error} 입력한 내용은 유지됩니다.
            </div>
          )}
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">학기 기간</legend>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-s`}>시작일</Label>
              <Input
                id={`${uid}-s`}
                type="date"
                value={form.semesterStart}
                onChange={(e) => setForm({ ...form, semesterStart: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-e`}>종료일</Label>
              <Input
                id={`${uid}-e`}
                type="date"
                value={form.semesterEnd}
                onChange={(e) => setForm({ ...form, semesterEnd: e.target.value })}
              />
            </div>
          </fieldset>

          <div>
            <h3 className="mb-2 text-sm font-semibold">과목</h3>
            <ul className="divide-y border-y">
              {form.courses.map((c, idx) => {
                const p = `${uid}-${c.id}`;
                return (
                  <li key={c.id} className="space-y-3 py-4">
                    <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_0.8fr_0.9fr_0.9fr_auto] sm:items-end">
                      <div className="space-y-1">
                        <Label htmlFor={`${p}-n`}>과목명</Label>
                        <Input
                          id={`${p}-n`}
                          value={c.name}
                          onChange={(e) => updateCourse(c.id, { name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`${p}-r`}>강의실</Label>
                        <Input
                          id={`${p}-r`}
                          value={c.room}
                          onChange={(e) => updateCourse(c.id, { room: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`${p}-w`}>요일</Label>
                        <select
                          id={`${p}-w`}
                          className={selectClass}
                          value={c.weekday}
                          onChange={(e) => updateCourse(c.id, { weekday: Number(e.target.value) })}
                        >
                          {WEEKDAYS.map((w, i) => (
                            <option key={w} value={i}>
                              {w}요일
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`${p}-st`}>시작</Label>
                        <Input
                          id={`${p}-st`}
                          type="time"
                          value={c.start}
                          onChange={(e) => updateCourse(c.id, { start: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`${p}-en`}>종료</Label>
                        <Input
                          id={`${p}-en`}
                          type="time"
                          value={c.end}
                          onChange={(e) => updateCourse(c.id, { end: e.target.value })}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="min-h-10 min-w-10 text-destructive"
                        aria-label={`${c.name || `${idx + 1}번째 과목`} 삭제`}
                        onClick={() =>
                          setForm({ ...form, courses: form.courses.filter((x) => x.id !== c.id) })
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">휴강일:</span>
                      {c.cancelledDates.length === 0 && (
                        <span className="text-muted-foreground">없음</span>
                      )}
                      {c.cancelledDates.map((d) => (
                        <span
                          key={d}
                          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5"
                        >
                          {formatShort(d)}
                          <button
                            type="button"
                            className="rounded p-1 hover:bg-accent"
                            aria-label={`${formatShort(d)} 휴강 취소`}
                            onClick={() =>
                              updateCourse(c.id, {
                                cancelledDates: c.cancelledDates.filter((x) => x !== d),
                              })
                            }
                          >
                            <X className="size-3" aria-hidden />
                          </button>
                        </span>
                      ))}
                      <Label htmlFor={`${p}-cx`} className="sr-only">
                        {c.name} 휴강일 추가
                      </Label>
                      <Input
                        id={`${p}-cx`}
                        type="date"
                        className="h-9 w-40"
                        min={form.semesterStart}
                        max={form.semesterEnd}
                        value={pendingCancel[c.id] ?? ""}
                        onChange={(e) =>
                          setPendingCancel((s) => ({ ...s, [c.id]: e.target.value }))
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!pendingCancel[c.id]}
                        onClick={() => {
                          const d = pendingCancel[c.id];
                          if (d && !c.cancelledDates.includes(d))
                            updateCourse(c.id, { cancelledDates: [...c.cancelledDates, d].sort() });
                          setPendingCancel((s) => ({ ...s, [c.id]: "" }));
                        }}
                      >
                        휴강 추가
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() =>
                setForm({
                  ...form,
                  courses: [
                    ...form.courses,
                    {
                      id: `c-${Date.now()}`,
                      name: "",
                      room: "",
                      weekday: 1,
                      start: "09:00",
                      end: "10:15",
                      cancelledDates: [],
                    },
                  ],
                })
              }
            >
              <Plus aria-hidden /> 과목 추가
            </Button>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? "저장 중…" : "시간표 저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
