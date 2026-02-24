import { useLocation } from "react-router-dom";

import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";

const titleMap: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/hosts": "Database Hosts",
  "/backups": "Backups & Restore",
};

export function TopBar() {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const title = titleMap[location.pathname] ?? "Database Hoarder";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-white px-4 py-4 lg:px-8">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-headline text-3xl gradient-text">{title}</h2>
        <div className="flex items-center gap-3">
          <p className="hidden text-sm text-muted-foreground md:block">
            {user?.username} · {user?.role}
          </p>
          <Button variant="secondary" onClick={signOut}>
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
}
