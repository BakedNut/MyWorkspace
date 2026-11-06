import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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
import { isValidTimeRange } from "@/lib/schedule";
import { WEEKDAYS, formatShort, toMinutes } from "@/lib/time";
import {
  courseAt,
  timetableDays,
  timetableRange,
  timetableTime,
  validateTimetable,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";
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
  const initialized = useRef(false);
  const editor = useRef<HTMLElement>(null);
  const [form, setForm] = useState<Timetable | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState("");

  useEffect(() => {
    if (!open) initialized.current = false;
    else if (timetable && !initialized.current) {
      // Background refetches must not replace an open, unsaved draft.
      initialized.current = true;
      setForm(structuredClone(timetable));
      setSelectedId(timetable.courses[0]?.id ?? "");
      setPendingCancel("");
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
  const selected = form.courses.find((c) => c.id === selectedId);
  const days = timetableDays(form.courses);
  const range = timetableRange(form.courses);
  const slots = Array.from(
    { length: (range.end - range.start) / 30 },
    (_, i) => range.start + i * 30,
  );
  const choose = (id: string) => {
    setSelectedId(id);
    setPendingCancel("");
    if (window.innerWidth < 1024)
      requestAnimationFrame(() =>
        editor.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      );
  };
  const updateCourse = (patch: Partial<Course>) => {
    setError(null);
    setForm(
      (f) =>
        f && {
          ...f,
          courses: f.courses.map((c) => (c.id === selectedId ? { ...c, ...patch } : c)),
        },
    );
  };
  const addCourse = (weekday = 1, minutes = 9 * 60, selectExisting = false) => {
    const existing = courseAt(form.courses, weekday, minutes);
    if (selectExisting && existing) return choose(existing.id);
    const course: Course = {
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "",
      room: "",
      professor: "",
      weekday,
      start: timetableTime(minutes),
      end: timetableTime(Math.min(minutes + 60, 1439)),
      cancelledDates: [],
    };
    setForm({ ...form, courses: [...form.courses, course] });
    setError(null);
    choose(course.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[96vw] max-w-6xl flex-col gap-0 overflow-hidden rounded-xl p-0">
        <DialogHeader className="border-b px-5 py-5 pr-10 text-left">
          <DialogTitle>학교 시간표 설정</DialogTitle>
          <DialogDescription>
            빈 시간을 눌러 수업을 추가하고, 수업 블록을 눌러 수정하세요.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div
            role="alert"
            className="mx-5 mt-4 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive"
          >
            {error} 입력한 내용은 유지됩니다.
          </div>
        )}
        <form
          id={`${uid}-form`}
          className="min-h-0 overflow-y-auto p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const issue = validateTimetable(form);
            setError(issue?.message ?? null);
            if (issue) {
              if (issue.courseId) choose(issue.courseId);
              return;
            }
            mut.mutate(form);
          }}
        >
          <fieldset disabled={mut.isPending} className="min-w-0 space-y-5">
            <legend className="sr-only">학기와 수업 편집</legend>
            <div className="grid items-end gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor={`${uid}-s`}>학기 시작일</Label>
                <Input
                  id={`${uid}-s`}
                  type="date"
                  className="bg-background"
                  value={form.semesterStart}
                  onChange={(e) => setForm({ ...form, semesterStart: e.target.value })}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor={`${uid}-e`}>학기 종료일</Label>
                <Input
                  id={`${uid}-e`}
                  type="date"
                  className="bg-background"
                  value={form.semesterEnd}
                  onChange={(e) => setForm({ ...form, semesterEnd: e.target.value })}
                />
              </div>
              <Button type="button" variant="outline" onClick={() => addCourse()}>
                <Plus aria-hidden /> 수업 추가
              </Button>
            </div>
            <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <section className="min-w-0" aria-label="주간 시간표">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <h3 className="font-semibold">
                    주간 시간표{" "}
                    <span className="ml-1 font-normal text-muted-foreground">
                      {form.courses.length}개 수업
                    </span>
                  </h3>
                  <span className="text-xs text-muted-foreground">분 단위 편집 가능</span>
                </div>
                <div
                  className="max-h-[480px] overflow-auto rounded-lg border"
                  tabIndex={0}
                  aria-label="시간표 스크롤 영역"
                >
                  <div
                    className="relative isolate grid bg-background"
                    style={{
                      minWidth: 56 + days.length * 112,
                      gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))`,
                      gridTemplateRows: `40px repeat(${range.end - range.start}, 1px)`,
                    }}
                  >
                    <div
                      className="sticky left-0 top-0 z-30 flex items-center justify-center border-b border-r bg-muted text-xs font-semibold"
                      style={{ gridColumn: 1, gridRow: 1 }}
                    >
                      시간
                    </div>
                    {days.map((day, index) => (
                      <div
                        key={day}
                        className="sticky top-0 z-20 flex items-center justify-center border-b border-r bg-muted text-sm font-semibold"
                        style={{ gridColumn: index + 2, gridRow: 1 }}
                      >
                        {WEEKDAYS[day]}요일
                      </div>
                    ))}
                    {slots.map((minutes) => (
                      <div
                        key={`time-${minutes}`}
                        className="sticky left-0 z-10 flex items-start justify-center border-r border-t bg-background pt-2 text-xs tabular-nums text-muted-foreground"
                        style={{ gridColumn: 1, gridRow: `${minutes - range.start + 2} / span 30` }}
                      >
                        {minutes % 60 === 0 ? timetableTime(minutes) : ""}
                      </div>
                    ))}
                    {days.flatMap((day, index) =>
                      slots.map((minutes) => (
                        <button
                          key={`${day}-${minutes}`}
                          type="button"
                          tabIndex={-1}
                          aria-label={`${WEEKDAYS[day]}요일 ${timetableTime(minutes)} 수업 추가`}
                          onClick={() => addCourse(day, minutes, true)}
                          className={cn(
                            "border-r border-b border-border/60 transition-colors hover:bg-accent",
                            Math.floor(minutes / 60) % 2 === 0 && "bg-muted/40",
                          )}
                          style={{
                            gridColumn: index + 2,
                            gridRow: `${minutes - range.start + 2} / span 30`,
                          }}
                        />
                      )),
                    )}
                    {form.courses
                      .filter((c) => isValidTimeRange(c.start, c.end))
                      .map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => choose(c.id)}
                          aria-pressed={selectedId === c.id}
                          aria-label={`${WEEKDAYS[c.weekday]}요일 ${c.name || "새 수업"} ${c.start}~${c.end} 수정`}
                          title={`${c.name || "새 수업"}${c.room ? ` (${c.room})` : ""}\n${c.professor ?? ""}\n${c.start}~${c.end}`}
                          className={cn(
                            "z-[1] mx-0.5 flex min-h-0 flex-col items-center justify-center overflow-hidden rounded-md border border-primary/25 bg-accent px-1 text-center text-xs text-accent-foreground outline-offset-1 hover:border-primary focus-visible:outline-2 focus-visible:outline-ring",
                            selectedId === c.id &&
                              "border-primary ring-2 ring-inset ring-primary/50",
                          )}
                          style={{
                            gridColumn: days.indexOf(c.weekday) + 2,
                            gridRow: `${toMinutes(c.start) - range.start + 2} / span ${toMinutes(c.end) - toMinutes(c.start)}`,
                          }}
                        >
                          <span
                            className={cn(
                              "w-full font-semibold",
                              toMinutes(c.end) - toMinutes(c.start) >= 60
                                ? "line-clamp-2 break-words"
                                : "truncate",
                            )}
                          >
                            {c.name || "새 수업"}
                            {c.room && ` (${c.room})`}
                          </span>
                          {c.professor && <span className="w-full truncate">{c.professor}</span>}
                          <span className="whitespace-nowrap tabular-nums">
                            {c.start}~{c.end}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  표를 위아래·좌우로 스크롤할 수 있습니다. 주말 수업을 추가하면 토·일요일도
                  표시됩니다.
                </p>
              </section>

              <section
                ref={editor}
                className="min-w-0 scroll-mt-4 space-y-4 rounded-lg border bg-muted/20 p-4"
                aria-label="선택한 수업 편집"
              >
                <h3 className="text-sm font-semibold">수업 상세</h3>
                {form.courses.length > 0 && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${uid}-selected`}>편집할 수업</Label>
                    <select
                      id={`${uid}-selected`}
                      className={selectClass}
                      value={selectedId}
                      onChange={(e) => choose(e.target.value)}
                    >
                      {!selected && <option value="">수업을 선택하세요</option>}
                      {form.courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {WEEKDAYS[c.weekday]} {c.start} · {c.name || "새 수업"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {selected ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${uid}-name`}>과목명</Label>
                      <Input
                        id={`${uid}-name`}
                        value={selected.name}
                        placeholder="예: 게임프로그래밍"
                        onChange={(e) => updateCourse({ name: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`${uid}-room`}>강의실</Label>
                        <Input
                          id={`${uid}-room`}
                          value={selected.room}
                          placeholder="6201"
                          onChange={(e) => updateCourse({ room: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`${uid}-professor`}>교수명</Label>
                        <Input
                          id={`${uid}-professor`}
                          value={selected.professor ?? ""}
                          placeholder="선택 입력"
                          onChange={(e) => updateCourse({ professor: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${uid}-day`}>요일</Label>
                      <select
                        id={`${uid}-day`}
                        className={selectClass}
                        value={selected.weekday}
                        onChange={(e) => updateCourse({ weekday: Number(e.target.value) })}
                      >
                        {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                          <option key={day} value={day}>
                            {WEEKDAYS[day]}요일
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`${uid}-start`}>시작</Label>
                        <Input
                          id={`${uid}-start`}
                          type="time"
                          step={60}
                          value={selected.start}
                          onChange={(e) => updateCourse({ start: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`${uid}-end`}>종료</Label>
                        <Input
                          id={`${uid}-end`}
                          type="time"
                          step={60}
                          value={selected.end}
                          onChange={(e) => updateCourse({ end: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2 border-t pt-3">
                      <Label htmlFor={`${uid}-cancel`}>휴강일</Label>
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        {selected.cancelledDates.length === 0 && (
                          <span className="text-muted-foreground">등록된 휴강일 없음</span>
                        )}
                        {selected.cancelledDates.map((d) => (
                          <span
                            key={d}
                            className="inline-flex items-center rounded-md bg-muted pl-2"
                          >
                            {formatShort(d)}
                            <button
                              type="button"
                              className="rounded p-2 hover:bg-accent"
                              aria-label={`${formatShort(d)} 휴강 취소`}
                              onClick={() =>
                                updateCourse({
                                  cancelledDates: selected.cancelledDates.filter((x) => x !== d),
                                })
                              }
                            >
                              <X className="size-3" aria-hidden />
                            </button>
                          </span>
                        ))}
                      </div>
                      <Input
                        id={`${uid}-cancel`}
                        type="date"
                        min={form.semesterStart}
                        max={form.semesterEnd}
                        value={pendingCancel}
                        onChange={(e) => setPendingCancel(e.target.value)}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full"
                        disabled={
                          !pendingCancel ||
                          pendingCancel < form.semesterStart ||
                          pendingCancel > form.semesterEnd
                        }
                        onClick={() => {
                          if (!selected.cancelledDates.includes(pendingCancel))
                            updateCourse({
                              cancelledDates: [...selected.cancelledDates, pendingCancel].sort(),
                            });
                          setPendingCancel("");
                        }}
                      >
                        휴강 추가
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full text-destructive"
                      onClick={() => {
                        setForm({
                          ...form,
                          courses: form.courses.filter((c) => c.id !== selected.id),
                        });
                        setSelectedId(form.courses.find((c) => c.id !== selected.id)?.id ?? "");
                        setPendingCancel("");
                        setError(null);
                      }}
                    >
                      <Trash2 aria-hidden /> 수업 삭제
                    </Button>
                  </>
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    빈 시간 칸이나 ‘수업 추가’를 눌러 첫 수업을 등록하세요.
                  </p>
                )}
              </section>
            </div>
          </fieldset>
        </form>
        <DialogFooter className="flex-row items-center justify-end gap-2 border-t bg-background px-5 py-4">
          <span className="mr-auto hidden text-xs text-muted-foreground sm:block">
            저장하면 캘린더와 메인에 반영됩니다.
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={mut.isPending}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button type="submit" form={`${uid}-form`} disabled={mut.isPending}>
            {mut.isPending ? "저장 중…" : "시간표 저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
