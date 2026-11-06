import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isPreview } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/time";
import type { ICloudDiscovery, ICloudStatus } from "@/types/domain";

export function ICloudDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const qc = useQueryClient();
  const {
    data,
    error: statusError,
    isPending,
    refetch,
  } = useQuery({
    queryKey: ["schedule", "icloud"],
    queryFn: () => api.calendar.getICloudStatus(),
    enabled: open,
  });
  const [appleId, setAppleId] = useState("");
  const [password, setPassword] = useState("");
  const [draft, setDraft] = useState<ICloudDiscovery | null>(null);
  const [calendarId, setCalendarId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reconnect, setReconnect] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  useEffect(() => {
    if (!open) {
      setPassword("");
      setAppleId("");
      setDraft(null);
      setReconnect(false);
      setConfirmDisconnect(false);
      setError("");
      setNotice("");
    }
  }, [open]);
  const connected = !!data?.calendarName;
  const changed = async (status?: ICloudStatus) => {
    if (status) qc.setQueryData(["schedule", "icloud"], status);
    await qc.invalidateQueries({ queryKey: ["schedule"] });
  };
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "요청을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>iCloud 연동 설정</DialogTitle>
          <DialogDescription>
            Apple의 앱 전용 암호로 캘린더를 연결합니다. 기존 서버 일정은 보존하며 자동으로 iCloud에
            올리지 않습니다.
          </DialogDescription>
        </DialogHeader>
        <dl className="divide-y border-y text-sm">
          <div className="flex justify-between gap-3 py-3">
            <dt className="text-muted-foreground">상태</dt>
            <dd>
              {statusError
                ? "확인하지 못했습니다."
                : isPending
                  ? "확인 중…"
                  : data?.state === "error"
                    ? "연결 확인 필요"
                    : connected
                      ? "연결됨"
                      : "연결 안 됨"}
            </dd>
          </div>
          {connected && (
            <>
              <div className="flex justify-between gap-3 py-3">
                <dt className="text-muted-foreground">계정</dt>
                <dd className="break-all text-right">{data?.accountLabel}</dd>
              </div>
              <div className="flex justify-between gap-3 py-3">
                <dt className="text-muted-foreground">캘린더</dt>
                <dd className="min-w-0 break-words text-right">{data?.calendarName}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between gap-3 py-3">
            <dt className="text-muted-foreground">마지막 동기화</dt>
            <dd>{data?.lastSyncedAt ? formatDateTime(data.lastSyncedAt) : "—"}</dd>
          </div>
        </dl>
        {(error || data?.message) && (
          <p role="alert" className="text-sm text-destructive">
            {error || data?.message}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-success">
            {notice}
          </p>
        )}
        {isPreview ? (
          <p className="text-sm text-muted-foreground">
            iCloud 연결은 실제 서비스 화면에서 진행하세요.
          </p>
        ) : statusError ? (
          <Button variant="outline" onClick={() => refetch()}>
            다시 확인
          </Button>
        ) : (!connected || reconnect) && !isPending ? (
          <>
            {data?.requiresHttps ? (
              <div className="space-y-3 rounded-lg bg-secondary p-4 text-sm">
                <p>계정 정보는 HTTPS 주소에서 안전하게 입력할 수 있습니다.</p>
                {data.secureSetupUrl ? (
                  <Button asChild>
                    <a href={data.secureSetupUrl} target="_blank" rel="noopener noreferrer">
                      HTTPS에서 연결
                    </a>
                  </Button>
                ) : (
                  <p>사이트의 HTTPS 주소로 접속해 주세요.</p>
                )}
              </div>
            ) : draft ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="icloud-calendar">연결할 캘린더</Label>
                  <select
                    id="icloud-calendar"
                    value={calendarId}
                    disabled={busy}
                    onChange={(e) => setCalendarId(e.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
                  >
                    {draft.calendars.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.name}
                        {calendar.readOnly ? " (읽기 전용)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-muted-foreground">
                  일반 일정은 양방향으로 반영합니다. 반복·여러 날·초대 일정은 조회만 지원하며 Apple
                  캘린더에서 수정할 수 있습니다.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy || !calendarId}
                    onClick={() =>
                      action(async () => {
                        const status = await api.calendar.connectICloud(
                          draft.draftToken,
                          calendarId,
                        );
                        setDraft(null);
                        setAppleId("");
                        setReconnect(false);
                        await changed(status);
                        setNotice("iCloud 캘린더를 연결했습니다.");
                      })
                    }
                  >
                    {busy ? "연결 중…" : "선택한 캘린더 연결"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setDraft(null);
                      setCalendarId("");
                    }}
                  >
                    계정 다시 입력
                  </Button>
                </div>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  action(async () => {
                    try {
                      const result = await api.calendar.discoverICloud({
                        appleId: appleId.trim(),
                        appPassword: password,
                      });
                      setDraft(result);
                      setCalendarId(result.calendars[0]?.id ?? "");
                    } finally {
                      setPassword("");
                    }
                  });
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="icloud-account">Apple ID</Label>
                  <Input
                    id="icloud-account"
                    type="email"
                    autoComplete="username"
                    placeholder="name@icloud.com"
                    value={appleId}
                    disabled={busy}
                    onChange={(event) => setAppleId(event.target.value)}
                    required
                    maxLength={254}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="icloud-app-password">앱 전용 암호</Label>
                  <Input
                    id="icloud-app-password"
                    type="password"
                    autoComplete="off"
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    value={password}
                    disabled={busy}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    maxLength={128}
                    aria-describedby="icloud-password-help"
                  />
                  <p id="icloud-password-help" className="text-xs text-muted-foreground">
                    Apple 계정의 일반 비밀번호를 입력하지 마세요. 암호는 서버에 암호화해 보관하며
                    브라우저에는 저장하지 않습니다.
                  </p>
                </div>
                <p className="text-sm">
                  <a
                    className="text-primary underline underline-offset-4"
                    href="https://account.apple.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Apple 계정에서 앱 전용 암호 발급
                  </a>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    로그인 및 보안 → 앱 암호에서 발급합니다. 이중 인증이 켜져 있어야 합니다.
                  </span>
                </p>
                <Button type="submit" disabled={busy || !appleId.trim() || !password}>
                  {busy ? "확인 중…" : "캘린더 목록 확인"}
                </Button>
              </form>
            )}
          </>
        ) : null}
        {connected && !isPreview && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              기본 동기화 간격은 60초입니다. 연결을 해제해도 iCloud 원본 일정과 기존 서버 일정은
              삭제되지 않습니다.
            </p>
            {confirmDisconnect ? (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-sm">iCloud 연결 정보를 서버에서 삭제할까요?</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        await api.calendar.disconnectICloud();
                        setConfirmDisconnect(false);
                        setReconnect(false);
                        setDraft(null);
                        await changed();
                        setNotice("iCloud 연결을 해제했습니다.");
                      })
                    }
                  >
                    연결 해제 확인
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmDisconnect(false)}
                  >
                    계속 연결
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await changed(await api.calendar.syncICloud());
                      setNotice("최신 일정을 확인했습니다.");
                    })
                  }
                >
                  {busy ? "처리 중…" : "지금 동기화"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setReconnect((old) => !old);
                    setDraft(null);
                    setError("");
                  }}
                >
                  {reconnect ? "다시 연결 취소" : "다시 연결"}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
                  연결 해제
                </Button>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
