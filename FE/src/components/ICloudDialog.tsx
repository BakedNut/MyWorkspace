import { useQuery } from "@tanstack/react-query";
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
import { formatDateTime } from "@/lib/time";

export function ICloudDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const { data, error } = useQuery({
    queryKey: ["schedule", "icloud"],
    queryFn: () => api.calendar.getICloudStatus(),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>iCloud 연동 설정</DialogTitle>
          <DialogDescription>
            iCloud는 나중에 연결합니다. 지금 입력한 일정은 서버에 저장됩니다.
          </DialogDescription>
        </DialogHeader>
        <dl className="divide-y border-y text-sm">
          <div className="flex justify-between py-3">
            <dt className="text-muted-foreground">상태</dt>
            <dd>
              {error
                ? "확인하지 못했습니다."
                : data
                  ? data.state === "connected"
                    ? "연결됨"
                    : "연결 안 됨"
                  : "확인 중…"}
            </dd>
          </div>
          <div className="flex justify-between py-3">
            <dt className="text-muted-foreground">마지막 동기화</dt>
            <dd>{data?.lastSyncedAt ? formatDateTime(data.lastSyncedAt) : "—"}</dd>
          </div>
        </dl>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
