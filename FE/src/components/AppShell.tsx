import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { CalendarDays, Home, LogOut, Menu, Power, Server, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "메인", icon: Home },
  { to: "/calendar", label: "캘린더", icon: CalendarDays },
  { to: "/server", label: "서버 대시보드", icon: Server },
  { to: "/wol", label: "WOL", icon: Power },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { status, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (path !== "/login" && status === "anon") navigate({ to: "/login" });
  }, [path, status, navigate]);
  useEffect(() => setOpen(false), [path]);

  if (path === "/login") return <main id="main">{children}</main>;

  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        본문으로 건너뛰기
      </a>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-sidebar-border bg-sidebar px-4 py-3 md:hidden">
        <span className="text-lg font-bold tracking-tight">MyWorkspace</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="site-nav"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md"
        >
          {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          <span className="sr-only">{open ? "메뉴 닫기" : "메뉴 열기"}</span>
        </button>
      </header>

      <aside
        id="site-nav"
        className={cn(
          "z-20 border-b border-sidebar-border bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-b-0 md:border-r",
          open ? "block" : "hidden",
        )}
      >
        <div className="hidden px-7 pb-8 pt-8 text-2xl font-bold tracking-tight md:block">
          MyWorkspace
        </div>
        <nav aria-label="주 메뉴" className="px-3 py-3 md:py-0">
          <ul className="space-y-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
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
          <p className="rounded-md border border-sidebar-border px-3 py-2 text-xs text-muted-foreground">
            디자인 미리보기 · 일정과 서버 정보는 샘플 데이터입니다.
          </p>
          <button
            type="button"
            onClick={() => logout()}
            className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-muted-foreground hover:text-foreground"
          >
            <LogOut aria-hidden className="size-4" /> 로그아웃
          </button>
        </div>
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
    </div>
  );
}
