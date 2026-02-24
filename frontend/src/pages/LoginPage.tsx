import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export function LoginPage() {
  const { user, signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn(username, password);
    } catch {
      setError("Failed to login. Check credentials.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">authentication</p>
        <h1 className="mt-3 font-headline text-4xl">
          Sign in to <span className="gradient-text">Database Hoarder</span>
        </h1>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm font-medium">
              Username
            </label>
            <Input id="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {error && <p className="rounded-xl border border-failure/30 bg-failure/10 p-3 text-sm text-failure">{error}</p>}

          <Button type="submit" fullWidth disabled={pending}>
            {pending ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
