import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "@/api";
import { mockControls } from "@/api/mock/mockApi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDateTime } from "@/lib/time";

export function ICloudDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const uid = useId();
  const { data } = useQuery({
    queryKey: ["schedule", "icloud"],
    queryFn: () => api.calendar.getICloudStatus(),
    enabled: open,
  });
  const [failSim, setFailSim] = useState(() => mockControls.get().simulateSaveFailure);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>iCloud 연동 설정</DialogTitle>
          <DialogDescription>
            <strong className="font-semibold text-foreground">시안 화면입니다.</strong> 실제 iCloud
            계정 연결이나 동기화는 일어나지 않습니다.
          </DialogDescription>
        </DialogHeader>
        <dl className="divide-y border-y text-sm">
          <div className="flex justify-between py-3">
            <dt className="text-muted-foreground">상태</dt>
            <dd>
              {data ? (data.state === "connected" ? "연결됨 (시안)" : "연결 안 됨") : "확인 중…"}
            </dd>
          </div>
          <div className="flex justify-between py-3">
            <dt className="text-muted-foreground">마지막 동기화</dt>
            <dd>{data?.lastSyncedAt ? formatDateTime(data.lastSyncedAt) : "—"}</dd>
          </div>
          <div className="flex justify-between py-3">
            <dt className="text-muted-foreground">계정</dt>
            <dd className="text-muted-foreground">아직 연결하지 않았습니다.</dd>
          </div>
        </dl>
        <div className="flex items-start gap-3 rounded-md bg-muted px-3 py-3">
          <Switch
            id={`${uid}-fail`}
            checked={failSim}
            onCheckedChange={(v) => {
              setFailSim(v);
              mockControls.set({ simulateSaveFailure: v });
            }}
          />
          <div>
            <Label htmlFor={`${uid}-fail`}>저장 실패 시뮬레이션 (데모)</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              켜면 일정·시간표 저장이 실패하고, 입력 내용이 보존되는 화면을 확인할 수 있습니다.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled title="시안에서는 동작하지 않습니다">
            지금 동기화 (시안)
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
