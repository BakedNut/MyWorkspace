import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MOCK_PASSWORD } from "@/api/mock/mockApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "로그인 · MyWorkspace" },
      { name: "description", content: "MyWorkspace 개인 공간에 로그인합니다." },
      { property: "og:title", content: "로그인 · MyWorkspace" },
      { property: "og:description", content: "MyWorkspace 개인 공간에 로그인합니다." },
    ],
  }),
  component: LoginPage,
});

/*
 * Mock login only. The real flow: POST /api/auth/login → the Spring Boot server
 * verifies the password, applies rate limiting and any trusted-IP policy, and sets
 * an HttpOnly session cookie. The frontend never inspects or trusts client IPs.
 */
function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (status === "authed") navigate({ to: "/" });
  }, [status, navigate]);

  return (
    <div className="grid min-h-dvh place-items-center bg-sidebar px-5">
      <form
        className="w-full max-w-sm rounded-xl border bg-background p-8"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setPending(true);
          try {
            await login(password);
          } catch (err) {
            setError(err instanceof Error ? err.message : "로그인하지 못했습니다.");
          } finally {
            setPending(false);
          }
        }}
      >
        <h1 className="text-2xl font-bold tracking-tight">MyWorkspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">비밀번호를 입력해 로그인하세요.</p>
        <div className="mt-6 space-y-1.5">
          <Label htmlFor="pw">비밀번호</Label>
          <Input
            id="pw"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? "pw-err" : "pw-hint"}
            required
            autoFocus
          />
          {error ? (
            <p id="pw-err" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : (
            <p id="pw-hint" className="text-xs text-muted-foreground">
              데모 모드 비밀번호:{" "}
              <code className="font-semibold text-foreground">{MOCK_PASSWORD}</code> (실제 인증
              아님)
            </p>
          )}
        </div>
        <Button type="submit" className="mt-6 w-full" size="lg" disabled={pending || !password}>
          {pending ? "확인 중…" : "로그인"}
        </Button>
      </form>
    </div>
  );
}
