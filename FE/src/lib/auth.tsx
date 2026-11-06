import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/api";

type Status = "checking" | "authed" | "anon";
interface AuthCtx {
  status: Status;
  login(password: string): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

/**
 * Client-side session state for the prototype.
 * This only controls what the UI shows. Real access control (password check,
 * HttpOnly session cookie, trusted-network policy) lives in the Spring Boot server.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    api.auth.getSession().then((s) => setStatus(s ? "authed" : "anon"));
  }, []);

  const login = useCallback(async (password: string) => {
    await api.auth.login(password);
    setStatus("authed");
  }, []);
  const logout = useCallback(async () => {
    await api.auth.logout();
    setStatus("anon");
  }, []);

  return <Ctx.Provider value={{ status, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
