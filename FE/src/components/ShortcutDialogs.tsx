import { useId, useState } from "react";
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
import { normalizeShortcutUrl } from "@/lib/shortcuts";
import type { ShortcutGroup, ShortcutLink } from "@/types/domain";

export type ShortcutDialogTarget =
  | { kind: "link"; link?: ShortcutLink; groupId?: string }
  | { kind: "group"; group?: ShortcutGroup }
  | { kind: "delete-group"; group: ShortcutGroup };

export function ShortcutDialog({
  target,
  groups,
  currentGroupId,
  initialGroupSelectionVersion,
  onClose,
  onRestoreFocus,
  onSaveLink,
  onSaveGroup,
  onDeleteGroup,
}: {
  target: ShortcutDialogTarget;
  groups: ShortcutGroup[];
  currentGroupId?: string | undefined;
  initialGroupSelectionVersion?: number | null | undefined;
  onClose(): void;
  onRestoreFocus(): void;
  onSaveLink(input: {
    name: string;
    url: string;
    groupId: string;
    groupSelectionVersion: number | null;
  }): Promise<void>;
  onSaveGroup(name: string): Promise<void>;
  onDeleteGroup(): Promise<void>;
}) {
  const uid = useId();
  const [name, setName] = useState(
    target.kind === "link" ? (target.link?.name ?? "") : (target.group?.name ?? ""),
  );
  const [url, setUrl] = useState(target.kind === "link" ? (target.link?.url ?? "") : "");
  const [groupId, setGroupId] = useState(
    target.kind === "link" ? (target.groupId ?? groups[0]?.id ?? "") : "",
  );
  const [groupSelectionVersion, setGroupSelectionVersion] = useState(0);
  const selectedGroupId =
    currentGroupId && initialGroupSelectionVersion === groupSelectionVersion
      ? currentGroupId
      : groups.some((group) => group.id === groupId)
        ? groupId
        : (currentGroupId ?? groups[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleting = target.kind === "delete-group";
  const title =
    target.kind === "link"
      ? target.link
        ? "바로가기 수정"
        : "바로가기 추가"
      : deleting
        ? "분류 삭제"
        : target.group
          ? "분류 이름 수정"
          : "분류 추가";
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="max-h-[90dvh] w-[94vw] max-w-lg overflow-y-auto rounded-xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {deleting
              ? `‘${target.group.name}’ 분류와 안에 있는 바로가기 ${target.group.links.length}개를 삭제합니다. 정리 모드에서 저장하면 반영됩니다.`
              : target.kind === "link"
                ? "이름과 사이트 주소를 입력하세요."
                : "바로가기를 묶어 둘 분류 이름을 입력하세요."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            setBusy(true);
            try {
              if (deleting) await onDeleteGroup();
              else {
                if (!name.trim() || /\p{Cc}/u.test(name))
                  throw new Error("이름을 줄바꿈 없이 입력하세요.");
                if (target.kind === "link")
                  await onSaveLink({
                    name: name.trim(),
                    url:
                      target.link && url === target.link.url
                        ? target.link.url
                        : normalizeShortcutUrl(url),
                    groupId: selectedGroupId,
                    groupSelectionVersion:
                      groupId === selectedGroupId ? groupSelectionVersion : null,
                  });
                else await onSaveGroup(name.trim());
              }
              onClose();
            } catch (issue) {
              setError(issue instanceof Error ? issue.message : "저장하지 못했습니다.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {!deleting && (
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              <legend className="sr-only">{title}</legend>
              <div className="min-w-0 space-y-2">
                <Label htmlFor={`${uid}-name`}>이름</Label>
                <Input
                  id={`${uid}-name`}
                  autoFocus
                  required
                  maxLength={target.kind === "link" ? 120 : 80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              {target.kind === "link" && (
                <>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor={`${uid}-url`}>URL</Label>
                    <Input
                      id={`${uid}-url`}
                      required
                      maxLength={2048}
                      inputMode="url"
                      autoCapitalize="none"
                      autoComplete="url"
                      spellCheck={false}
                      placeholder="https://example.com"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor={`${uid}-group`}>분류</Label>
                    <select
                      id={`${uid}-group`}
                      value={selectedGroupId}
                      onChange={(event) => {
                        setGroupId(event.target.value);
                        setGroupSelectionVersion((version) => version + 1);
                      }}
                      className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {groups.length ? (
                        groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))
                      ) : (
                        <option value="">미분류</option>
                      )}
                    </select>
                  </div>
                </>
              )}
            </fieldset>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={busy} variant={deleting ? "destructive" : "default"}>
              {busy ? "처리 중…" : deleting ? "삭제" : "완료"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
