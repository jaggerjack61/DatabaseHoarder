import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Lock, RotateCcw, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/context/AuthContext";
import { defaultTransition, fadeUp } from "@/lib/motion";

const highlights = [
  {
    title: "Policy-Driven Scheduling",
    description: "Orchestrate backups by interval and weekday windows with retention exceptions.",
    icon: ShieldCheck,
  },
  {
    title: "Replication Control",
    description: "Mirror critical backup sets to remote storage hosts with independent cadence.",
    icon: RotateCcw,
  },
  {
    title: "Secure Restore Workflow",
    description: "Run guarded restore jobs with explicit confirmation and immutable audit traces.",
    icon: Lock,
  },
];

export function LandingPage() {
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();

  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-4 py-8 lg:px-8 lg:py-10">
      <div className="pointer-events-none absolute -left-16 top-10 h-64 w-64 rounded-full bg-accent/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-10 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <motion.section
          initial={fadeUp.initial}
          animate={fadeUp.animate}
          transition={reduceMotion ? { duration: 0 } : defaultTransition}
          className="surface relative overflow-hidden rounded-2xl p-8 lg:p-12"
        >
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">Database Hoarder</p>
          <h1 className="mt-4 max-w-3xl font-headline text-5xl leading-tight text-foreground lg:text-6xl">
            Enterprise backup orchestration with <span className="gradient-text">Database Hoarder</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-muted-foreground lg:text-base">
            Manage backup schedules, replication policies, restores, and operational visibility from one secure system.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={user ? "/dashboard" : "/login"}>
              <Button>
                {user ? "Open Dashboard" : "Sign In"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link to={user ? "/backups" : "/login"}>
              <Button variant="secondary">View Backups</Button>
            </Link>
          </div>
        </motion.section>

        <section className="grid gap-4 lg:grid-cols-3">
          {highlights.map((item, index) => (
            <motion.div
              key={item.title}
              initial={fadeUp.initial}
              animate={fadeUp.animate}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : {
                      ...defaultTransition,
                      delay: index * 0.08,
                    }
              }
            >
              <Card className="h-full bg-white/95">
                <item.icon className="h-5 w-5 text-accent" />
                <h2 className="mt-4 font-headline text-2xl text-foreground">{item.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
              </Card>
            </motion.div>
          ))}
        </section>
      </div>
    </main>
  );
}
