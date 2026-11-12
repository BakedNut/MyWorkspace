import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bookmark, Check, FolderPlus, GripVertical, Plus } from "lucide-react";
import { useState } from "react";
import { ApiError, api } from "@/api";
import { ShortcutBoard } from "@/components/ShortcutBoard";
import { ShortcutDialog, type ShortcutDialogTarget } from "@/components/ShortcutDialogs";
import { Button } from "@/components/ui/button";
import type { ShortcutBoard as Board } from "@/types/domain";

export const Route = createFileRoute("/shortcuts")({
  head: ({ match }) => ({
    meta: [
      { title: `바로가기 · ${match.context.siteName}` },
      { name: "description", content: "분류별로 모아 둔 사이트 바로가기" },
    ],
  }),
  component: ShortcutsPage,
});

const queryKey = ["shortcuts"];
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

function ShortcutsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: () => api.shortcuts.get(),
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState<Board | null>(null);
  const [dialog, setDialog] = useState<ShortcutDialogTarget | null>(null);
  const mutation = useMutation({
    mutationFn: (board: Board) => api.shortcuts.save(board),
    onSuccess: (saved) => queryClient.setQueryData(queryKey, saved),
    onError: (error) => {
      if (error instanceof ApiError && error.code === "CONFLICT")
        void queryClient.invalidateQueries({ queryKey });
    },
  });
  const board = draft ?? query.data;
  const editing = draft !== null;
  const change = async (next: Board) => {
    if (editing) setDraft(next);
    else await mutation.mutateAsync(next);
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">바로가기</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="h-10 px-3 sm:px-4"
            variant="outline"
            disabled={!board || mutation.isPending}
            onClick={() => setDialog({ kind: "group" })}
          >
            <FolderPlus aria-hidden /> 분류 추가
          </Button>
          {editing ? (
            <>
              <Button
                className="h-10 px-3 sm:px-4"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => {
                  setDraft(null);
                  mutation.reset();
                }}
              >
                취소
              </Button>
              <Button
                className="h-10 px-3 sm:px-4"
                disabled={mutation.isPending}
                onClick={async () => {
                  if (!draft) return;
                  try {
                    await mutation.mutateAsync(draft);
                    setDraft(null);
                  } catch {
                    /* Keep the draft for retry. */
                  }
                }}
              >
                <Check aria-hidden />
                {mutation.isPending ? "저장 중…" : "저장"}
              </Button>
            </>
          ) : (
            <>
              <Button
                className="h-10 px-3 sm:px-4"
                variant="outline"
                disabled={!board || mutation.isPending}
                onClick={() => {
                  mutation.reset();
                  setDraft(structuredClone(board!));
                }}
              >
                <GripVertical aria-hidden /> 정리
              </Button>
              <Button
                className="h-10 px-3 sm:px-4"
                disabled={!board || mutation.isPending}
                onClick={() => setDialog({ kind: "link" })}
              >
                <Plus aria-hidden /> 추가
              </Button>
            </>
          )}
        </div>
      </div>
      {editing && (
        <p className="mb-5 rounded-lg bg-secondary px-4 py-3 text-sm text-secondary-foreground">
          이동 손잡이를 드래그해 순서와 분류를 바꾼 뒤 저장하세요. 키보드는 손잡이에서 스페이스 키와
          방향키를 사용합니다.
        </p>
      )}
      {query.isLoading && (
        <p role="status" className="py-8 text-muted-foreground">
          바로가기를 불러오는 중…
        </p>
      )}
      {query.error && (
        <div
          role="alert"
          className="mb-5 flex flex-wrap items-center gap-3 text-sm text-destructive"
        >
          바로가기를 불러오지 못했습니다.
          <Button variant="outline" onClick={() => void query.refetch()}>
            다시 시도
          </Button>
        </div>
      )}
      {mutation.error && !dialog && (
        <p role="alert" className="mb-5 text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
      {board && (
        <>
          {board.groups.length === 0 && (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-5 text-center">
              <Bookmark aria-hidden className="mb-1 size-8 text-primary/70" />
              <p className="font-medium">자주 찾는 사이트를 모아 보세요.</p>
              <Button variant="outline" onClick={() => setDialog({ kind: "link" })}>
                <Plus aria-hidden /> 바로가기 추가
              </Button>
            </div>
          )}
          <ShortcutBoard
            board={board}
            editing={editing}
            busy={mutation.isPending}
            onChange={(next) => {
              void change(next).catch(() => {});
            }}
            onEditLink={(link, groupId) => setDialog({ kind: "link", link, groupId })}
            onEditGroup={(group) => setDialog({ kind: "group", group })}
            onDeleteGroup={(group) => setDialog({ kind: "delete-group", group })}
          />
          {dialog && (
            <ShortcutDialog
              key={`${dialog.kind}-${dialog.kind === "link" ? (dialog.link?.id ?? "new") : (dialog.group?.id ?? "new")}`}
              target={dialog}
              groups={board.groups}
              onClose={() => {
                setDialog(null);
                mutation.reset();
              }}
              onSaveLink={async ({ name, url, groupId }) => {
                const id = dialog.kind === "link" ? (dialog.link?.id ?? newId()) : newId();
                const group = groupId || board.groups[0]?.id || newId();
                if (board.groups.length && !board.groups.some((item) => item.id === group))
                  throw new Error("분류가 변경됐습니다. 분류를 다시 선택하세요.");
                const groups = board.groups.length
                  ? board.groups
                  : [{ id: group, name: "미분류", collapsed: false, links: [] }];
                await change({
                  ...board,
                  groups: groups.map((item) => {
                    if (item.id !== group)
                      return { ...item, links: item.links.filter((link) => link.id !== id) };
                    const exists = item.links.some((link) => link.id === id);
                    const links = exists
                      ? item.links.map((link) => (link.id === id ? { id, name, url } : link))
                      : [...item.links, { id, name, url }];
                    return { ...item, links };
                  }),
                });
              }}
              onSaveGroup={async (name) => {
                const selected = dialog.kind === "group" ? dialog.group : undefined;
                const groups = selected
                  ? board.groups.map((group) =>
                      group.id === selected.id ? { ...group, name } : group,
                    )
                  : [...board.groups, { id: newId(), name, collapsed: false, links: [] }];
                await change({ ...board, groups });
              }}
              onDeleteGroup={async () => {
                if (dialog.kind === "delete-group")
                  await change({
                    ...board,
                    groups: board.groups.filter((group) => group.id !== dialog.group.id),
                  });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
