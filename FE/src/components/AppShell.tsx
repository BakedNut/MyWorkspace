import * as Dialog from "@radix-ui/react-dialog";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { CalendarDays, Home, LogOut, Menu, Power, Server, Settings, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { isPreview } from "@/api";

const NAV = [
  { to: "/", label: "메인", icon: Home },
  { to: "/calendar", label: "캘린더", icon: CalendarDays },
  { to: "/server", label: "서버 대시보드", icon: Server },
  { to: "/wol", label: "WOL", icon: Power },
] as const;
const SecurityDialog = lazy(() =>
  import("./SecurityDialog").then((module) => ({ default: module.SecurityDialog })),
);

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { status, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (path !== "/login" && status === "anon") navigate({ to: "/login" });
  }, [path, status, navigate]);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  if (path === "/login") return <main id="main">{children}</main>;

  const navigation = (
    <>
      <nav aria-label="주 메뉴" className="px-3 py-3 md:py-0">
        <ul className="space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                onClick={() => setOpen(false)}
                activeOptions={{ exact: to === "/" }}
                className="flex min-h-11 items-center gap-3 rounded-lg px-4 py-2.5 text-[15px] transition-colors hover:bg-sidebar-accent/50 data-[status=active]:bg-sidebar-accent data-[status=active]:font-semibold data-[status=active]:text-sidebar-accent-foreground"
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto space-y-3 px-6 pb-6 pt-4 text-sm">
        <button
          type="button"
          disabled={status !== "authed"}
          onClick={() => {
            setOpen(false);
            setSettingsOpen(true);
          }}
          className="flex min-h-11 items-center gap-2 rounded-md px-1 text-muted-foreground hover:text-foreground"
          aria-label="암호 설정"
        >
          <Settings aria-hidden className="size-4" />
          암호 설정
        </button>
        {isPreview && (
          <p className="rounded-md border border-sidebar-border px-3 py-2 text-xs text-muted-foreground">
            디자인 미리보기 · 일정과 서버 정보는 샘플 데이터입니다.
          </p>
        )}
        <button
          type="button"
          onClick={() => logout()}
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-muted-foreground hover:text-foreground"
        >
          <LogOut aria-hidden className="size-4" /> 로그아웃
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        본문으로 건너뛰기
      </a>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 py-3 md:hidden">
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md"
              aria-label="메뉴 열기"
            >
              <Menu aria-hidden className="size-5" />
            </button>
          </Dialog.Trigger>
          <span className="text-lg font-bold tracking-tight">MyWorkspace</span>
        </header>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 md:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl outline-none md:hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <Dialog.Title className="text-xl font-bold">MyWorkspace</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="메뉴 닫기"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md"
                >
                  <X aria-hidden className="size-5" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">페이지를 선택하는 주 메뉴</Dialog.Description>
            {navigation}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="px-7 pb-8 pt-8 text-2xl font-bold">MyWorkspace</div>
        {navigation}
      </aside>

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
        {status === "authed" ? (
          children
        ) : (
          <p className="p-10 text-muted-foreground" role="status">
            세션 확인 중…
          </p>
        )}
      </main>
      {settingsOpen && (
        <Suspense fallback={null}>
          <SecurityDialog open onOpenChange={setSettingsOpen} />
        </Suspense>
      )}
    </div>
  );
}
