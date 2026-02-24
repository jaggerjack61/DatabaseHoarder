import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { clearTokens, getMe, getStoredTokens, login, registerUnauthorizedHandler, storeTokens } from "@/lib/api";
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
  const navigate = useNavigate();
  const location = useLocation();

  const signOut = useCallback(() => {
    clearTokens();
    setAccessToken(null);
    setUser(null);
    if (location.pathname !== "/login") {
      navigate("/login", { replace: true });
    }
  }, [location.pathname, navigate]);

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
        signOut();
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();
  }, [signOut]);

  useEffect(() => {
    registerUnauthorizedHandler(signOut);
    return () => registerUnauthorizedHandler(null);
  }, [signOut]);

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
      signOut,
    }),
    [user, accessToken, loading, signOut],
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
