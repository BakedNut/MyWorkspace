import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ExternalLink, Folder, GripVertical, Pencil, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ShortcutIcon } from "@/components/ShortcutIcon";
import { moveShortcut, parseShortcutUrl } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import type { ShortcutBoard as Board, ShortcutGroup, ShortcutLink } from "@/types/domain";

const collision: CollisionDetection = (args) => {
  const containers = args.droppableContainers.filter(
    (item) =>
      args.active.data.current?.["kind"] !== "group" || item.data.current?.["kind"] === "group",
  );
  const options = { ...args, droppableContainers: containers };
  const hits = pointerWithin(options);
  const link = hits.find((hit) => String(hit.id).startsWith("link:"));
  if (args.pointerCoordinates) return link ? [link] : hits;
  return closestCenter(options);
};

interface Props {
  board: Board;
  editing: boolean;
  busy: boolean;
  onChange(board: Board, deletedLinkId?: string): void;
  onEditLink(link: ShortcutLink, groupId: string): void;
  onEditGroup(group: ShortcutGroup): void;
  onDeleteGroup(group: ShortcutGroup): void;
}

export function ShortcutBoard({
  board,
  editing,
  busy,
  onChange,
  onEditLink,
  onEditGroup,
  onDeleteGroup,
}: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const finish = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over || active.id === over.id) return;
    const from = active.data.current;
    const to = over.data.current;
    if (!from || !to) return;
    if (from["kind"] === "group" && to["kind"] === "group") {
      const start = board.groups.findIndex((group) => group.id === from["groupId"]);
      const end = board.groups.findIndex((group) => group.id === to["groupId"]);
      onChange({ ...board, groups: arrayMove(board.groups, start, end) });
    } else if (from["kind"] === "link") {
      onChange(moveShortcut(board, from["linkId"], to["groupId"], to["linkId"]));
    }
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={({ active }) => setDragging(active.data.current?.["name"] ?? null)}
      onDragEnd={finish}
      onDragCancel={() => setDragging(null)}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "스페이스 키로 이동을 시작하고 방향키로 옮긴 뒤 스페이스 키로 놓으세요. Escape 키로 취소합니다.",
        },
        announcements: {
          onDragStart: ({ active }) => `${active.data.current?.["name"]} 이동 시작`,
          onDragOver: ({ over }) =>
            over ? `${over.data.current?.["name"]} 위치` : "놓을 위치를 선택하세요.",
          onDragEnd: () => "이동 완료. 저장 버튼으로 반영하세요.",
          onDragCancel: () => "이동 취소",
        },
      }}
    >
      <SortableContext
        items={board.groups.map((group) => `group:${group.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-5">
          {board.groups.map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              editing={editing}
              busy={busy}
              onToggle={() =>
                onChange({
                  ...board,
                  groups: board.groups.map((item) =>
                    item.id === group.id ? { ...item, collapsed: !item.collapsed } : item,
                  ),
                })
              }
              onEdit={() => onEditGroup(group)}
              onDelete={() => onDeleteGroup(group)}
            >
              <SortableContext
                items={group.links.map((link) => `link:${link.id}`)}
                strategy={rectSortingStrategy}
              >
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {group.links.map((link) => (
                    <LinkCard
                      key={link.id}
                      link={link}
                      groupId={group.id}
                      editing={editing}
                      busy={busy}
                      onEdit={() => onEditLink(link, group.id)}
                      onDelete={() =>
                        onChange(
                          {
                            ...board,
                            groups: board.groups.map((item) =>
                              item.id === group.id
                                ? {
                                    ...item,
                                    links: item.links.filter((entry) => entry.id !== link.id),
                                  }
                                : item,
                            ),
                          },
                          link.id,
                        )
                      }
                    />
                  ))}
                </ul>
              </SortableContext>
              {group.links.length === 0 && (
                <p className="py-5 text-center text-sm text-muted-foreground">
                  {editing ? "바로가기를 여기로 옮길 수 있습니다." : "등록된 바로가기가 없습니다."}
                </p>
              )}
            </GroupSection>
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {dragging && (
          <div className="max-w-72 truncate rounded-xl border border-primary/30 bg-card p-4 font-medium shadow-lg">
            {dragging}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function GroupSection({
  group,
  editing,
  busy,
  onToggle,
  onEdit,
  onDelete,
  children,
}: {
  group: ShortcutGroup;
  editing: boolean;
  busy: boolean;
  onToggle(): void;
  onEdit(): void;
  onDelete(): void;
  children: ReactNode;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: `group:${group.id}`,
    data: { kind: "group", groupId: group.id, name: group.name },
    disabled: !editing || busy,
  });
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      aria-label={group.name}
      data-group-id={group.id}
      className={cn(
        "min-w-0 rounded-xl border bg-card shadow-sm",
        isDragging && "opacity-30",
        isOver && editing && "border-primary/60",
      )}
    >
      <div className="flex min-w-0 items-center gap-1 rounded-t-xl bg-secondary/60 px-3 py-2.5 sm:px-4">
        {editing && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="touch-none shrink-0 cursor-grab"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            disabled={busy}
            aria-label={`${group.name} 분류 이동`}
          >
            <GripVertical aria-hidden />
          </Button>
        )}
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            disabled={busy}
            onClick={onToggle}
            aria-expanded={!group.collapsed}
            aria-controls={`group-content-${group.id}`}
            className="flex min-h-10 w-full min-w-0 items-center gap-2.5 text-left"
          >
            <Folder aria-hidden className="size-4 shrink-0 text-primary" />
            <span className="truncate font-semibold">{group.name}</span>
            <span className="text-xs tabular text-muted-foreground">{group.links.length}</span>
            <ChevronDown
              aria-hidden
              className={cn(
                "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
                group.collapsed && "-rotate-90",
              )}
            />
          </button>
        </h2>
        {editing && (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={busy}
              aria-label={`${group.name} 분류 이름 수정`}
              onClick={onEdit}
            >
              <Pencil aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={busy}
              aria-label={`${group.name} 분류 삭제`}
              onClick={onDelete}
            >
              <Trash2 aria-hidden />
            </Button>
          </>
        )}
      </div>
      <div id={`group-content-${group.id}`} hidden={group.collapsed} className="min-w-0 p-3 sm:p-4">
        {children}
      </div>
    </section>
  );
}

function LinkCard({
  link,
  groupId,
  editing,
  busy,
  onEdit,
  onDelete,
}: {
  link: ShortcutLink;
  groupId: string;
  editing: boolean;
  busy: boolean;
  onEdit(): void;
  onDelete(): void;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: `link:${link.id}`,
    data: { kind: "link", linkId: link.id, groupId, name: link.name },
    disabled: !editing || busy,
  });
  const site = parseShortcutUrl(link.url);
  const content = (
    <>
      <ShortcutIcon key={link.url} link={link} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{link.name}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {site?.host ?? "잘못된 주소 · 정리에서 수정하세요."}
        </span>
      </span>
    </>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-link-id={link.id}
      className={cn(
        "min-w-0 rounded-xl border bg-card transition-colors",
        editing ? "p-3" : "hover:border-primary/40 hover:bg-accent/40",
        isDragging && "opacity-30",
        isOver && editing && "border-primary ring-1 ring-primary/30",
      )}
    >
      {editing ? (
        <>
          <div className="flex min-w-0 items-center gap-3">{content}</div>
          <div className="mt-3 flex items-center gap-1 border-t pt-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              className="touch-none cursor-grab"
              disabled={busy}
              aria-label={`${link.name} 바로가기 이동`}
            >
              <GripVertical aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto"
              disabled={busy}
              onClick={onEdit}
              aria-label={`${link.name} 바로가기 수정`}
            >
              <Pencil aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={busy}
              onClick={onDelete}
              aria-label={`${link.name} 바로가기 삭제`}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        </>
      ) : site ? (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 items-center gap-3 rounded-xl p-4"
          aria-label={`${link.name} 새 탭에서 열기`}
        >
          {content}
          <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </a>
      ) : (
        <div className="flex min-w-0 items-center gap-3 rounded-xl p-4">{content}</div>
      )}
    </li>
  );
}
