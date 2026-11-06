import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeadContent, Link, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({ meta: [{ title: "MyWorkspace" }] }),
  component: RootComponent,
  notFoundComponent: () => (
    <div className="p-8">
      <h1 className="text-xl font-bold">페이지를 찾을 수 없습니다.</h1>
      <Link to="/" className="mt-4 inline-block text-primary">
        메인으로 이동
      </Link>
    </div>
  ),
  errorComponent: ({ reset }) => (
    <div className="p-8" role="alert">
      <p>화면을 불러오지 못했습니다.</p>
      <button onClick={reset} className="mt-4 text-primary">
        다시 시도
      </button>
    </div>
  ),
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <HeadContent />
      <AuthProvider>
        <AppShell>
          <Outlet />
        </AppShell>
      </AuthProvider>
    </QueryClientProvider>
  );
}
