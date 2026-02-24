import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { clearTokens, getMe, getStoredTokens, login, storeTokens } from "@/lib/api";
import { CurrentUser } from "@/types/api";

interface AuthContextValue {
  user: CurrentUser | null;
  accessToken: string | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const bootstrap = async () => {
      const tokens = getStoredTokens();
      if (!tokens) {
        setLoading(false);
        return;
      }
      try {
        const me = await getMe(tokens.access);
        setAccessToken(tokens.access);
        setUser(me);
      } catch {
        clearTokens();
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      loading,
      signIn: async (username: string, password: string) => {
        const tokens = await login(username, password);
        storeTokens(tokens);
        const me = await getMe(tokens.access);
        setAccessToken(tokens.access);
        setUser(me);
      },
      signOut: () => {
        clearTokens();
        setAccessToken(null);
        setUser(null);
      },
    }),
    [user, accessToken, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
