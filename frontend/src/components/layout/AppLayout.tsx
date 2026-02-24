import { Outlet } from "react-router-dom";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[18rem_1fr]">
      <Sidebar />
      <div className="flex min-h-screen flex-col">
        <TopBar />
        <main className="flex-1 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
