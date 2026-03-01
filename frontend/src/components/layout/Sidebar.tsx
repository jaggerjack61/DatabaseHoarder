import { motion, useReducedMotion } from "framer-motion";
import { Activity, CalendarDays, Database, HardDrive, LayoutDashboard, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";

import { useAuth } from "@/context/AuthContext";
import { defaultTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/hosts", icon: HardDrive, label: "Hosts" },
  { to: "/backups", icon: Database, label: "Backups" },
  { to: "/planned-events", icon: CalendarDays, label: "Planned Events" },
  { to: "/monitor", icon: Activity, label: "Live Monitor" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const visibleItems = navItems.filter((item) => (item.to === "/settings" ? user?.role === "ADMIN" : true));

  return (
    <aside className="hidden w-72 flex-col border-r border-foreground/20 bg-foreground p-6 text-white lg:flex">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/70">Database Hoarder</p>
      <h1 className="mt-3 font-headline text-3xl">Control Plane</h1>
      <nav className="mt-8 space-y-2">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition",
                isActive ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/5",
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
                {isActive && (
                  <motion.span
                    className="ml-auto h-2 w-2 rounded-full bg-accent"
                    animate={reduceMotion ? undefined : { opacity: [0.4, 1, 0.4] }}
                    transition={reduceMotion ? undefined : { ...defaultTransition, duration: 1.8, repeat: Infinity }}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
