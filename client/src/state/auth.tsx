import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PublicUser, Role } from '@shared/types';
import { api, setToken, setUnauthorizedHandler } from '../lib/api';

const KEY = 'vertex.session';
const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

interface Session {
  token: string;
  user: PublicUser;
}

interface AuthCtx {
  session: Session | null;
  ready: boolean;
  login(username: string, password: string): Promise<void>;
  logout(): void;
  can(role: Role): boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

function load(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    setToken(null);
    setSession(null);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // Restore and re-validate a stored session (the server may have restarted).
  useEffect(() => {
    setUnauthorizedHandler(logout);
    const stored = load();
    if (!stored) {
      setReady(true);
      return;
    }
    setToken(stored.token);
    api
      .me()
      .then(({ user }) => setSession({ token: stored.token, user }))
      .catch(() => logout())
      .finally(() => setReady(true));
  }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    setToken(res.token);
    setSession(res);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(res));
    } catch {
      /* ignore */
    }
  }, []);

  const can = useCallback((role: Role) => !!session && RANK[session.user.role] >= RANK[role], [session]);

  return <Ctx.Provider value={{ session, ready, login, logout, can }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
