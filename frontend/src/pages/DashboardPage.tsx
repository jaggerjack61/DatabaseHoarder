import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { useAuth } from "@/context/AuthContext";
import { getDashboardMetrics } from "@/lib/api";
import { defaultTransition, fadeUp } from "@/lib/motion";

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, power);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[power]}`;
}

export function DashboardPage() {
  const { accessToken } = useAuth();
  const reduceMotion = useReducedMotion();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof getDashboardMetrics>> | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!accessToken) return;
      setLoading(true);
      setError(null);
      try {
        const payload = await getDashboardMetrics(accessToken);
        setMetrics(payload);
      } catch {
        setError("Unable to load dashboard metrics.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [accessToken]);

  const metricCards = useMemo(() => {
    const largest = metrics?.largest_databases?.[0];
    const mostBacked = metrics?.most_backed_up_databases?.[0];
    const growth = metrics?.largest_growth?.[0];

    return [
      { label: "Largest Databases", value: largest ? `${largest.database} · ${formatBytes(largest.size)}` : "No data" },
      {
        label: "Most Backed-Up",
        value: mostBacked ? `${mostBacked["database_config__database__name"]} · ${mostBacked.total} backups` : "No data",
      },
      {
        label: "Largest Growth",
        value: growth ? `${growth.delta >= 0 ? "+" : ""}${formatBytes(growth.delta)}` : "No data",
      },
      { label: "Failure Rate", value: `${metrics?.failure_rate ?? 0}%` },
    ];
  }, [metrics]);

  return (
    <div className="space-y-10">
      <Section label="overview" title="Operational Backup Analytics">
        <div className="grid items-stretch gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div
            initial={fadeUp.initial}
            animate={fadeUp.animate}
            transition={reduceMotion ? { duration: 0 } : defaultTransition}
            className="relative overflow-hidden rounded-xl bg-white p-8 shadow-soft"
          >
            <div className="pointer-events-none absolute -right-12 -top-12 h-56 w-56 rounded-full bg-accent/10 blur-2xl" />
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">hero</p>
            <h1 className="mt-4 font-headline text-5xl leading-tight text-foreground">
              Keep every backup <span className="gradient-text">safe, scheduled, and restorable</span>
            </h1>
          </motion.div>

          <div className="relative grid gap-4 sm:grid-cols-2">
            <motion.div
              className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/25"
              animate={reduceMotion ? undefined : { rotate: 360 }}
              transition={reduceMotion ? undefined : { duration: 60, repeat: Infinity, ease: "linear" }}
            />
            {metricCards.map((item, index) => (
              <motion.div
                key={item.label}
                initial={fadeUp.initial}
                animate={fadeUp.animate}
                transition={reduceMotion ? { duration: 0 } : { ...defaultTransition, delay: index * 0.08 }}
              >
                <Card className="relative h-full bg-white/95">
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{item.value}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
        {loading && <p className="text-sm text-muted-foreground">Loading live metrics...</p>}
        {error && <p className="text-sm text-failure">{error}</p>}
      </Section>

      <Section label="critical" title="System Alerts" className="rounded-xl bg-foreground p-8 text-white dot-pattern">
        <p className="max-w-2xl text-white/90">
          Critical backups, retention overrides, and restore operations are tracked in immutable audit logs with policy enforcement.
        </p>
      </Section>
    </div>
  );
}
