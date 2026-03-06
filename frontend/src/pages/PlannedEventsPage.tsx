import { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";
import { useAuth } from "@/context/AuthContext";
import {
  getBackups,
  getConfigVersions,
  getDatabases,
  getReplicationPolicyVersions,
  getRestoreConfigVersions,
  getRestoreJobs,
  getStorageHosts,
} from "@/lib/api";
import {
  Backup,
  Database,
  DatabaseConfigVersion,
  ReplicationPolicyVersion,
  RestoreConfigVersion,
  RestoreJob,
  StorageHost,
} from "@/types/api";

type PlannedEventType = "backup" | "replication" | "restore";

type PlannedEvent = {
  type: PlannedEventType;
  minuteOfDay: number;
  label: string;
  dbName?: string;
  targetName?: string;
};

type DaySummary = {
  date: Date;
  backups: number;
  replications: number;
  restores: number;
};

type DayStatus = {
  total: number;
  failed: number;
};

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_OPTIONS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const EVENT_COLORS: Record<PlannedEventType, { bg: string; text: string; border: string; dot: string; badge: string }> = {
  backup: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", dot: "bg-blue-500", badge: "bg-blue-100 text-blue-700" },
  restore: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500", badge: "bg-amber-100 text-amber-700" },
  replication: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", dot: "bg-violet-500", badge: "bg-violet-100 text-violet-700" },
};

function toConfigWeekday(jsWeekday: number) {
  return (jsWeekday + 6) % 7;
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isVersionActiveOnDate(
  value: { effective_from: string; effective_to: string | null },
  date: Date,
) {
  const from = parseDate(value.effective_from);
  const to = parseDate(value.effective_to);
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  if (from && from > dayEnd) return false;
  if (to && to <= dayStart) return false;
  return true;
}

function formatTime(minuteOfDay: number) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const amPm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${amPm}`;
}

function occurrenceMinutesFromFrequency(frequencyMinutes: number) {
  if (!frequencyMinutes || frequencyMinutes <= 0) return [] as number[];
  const safeFrequency = Math.max(1, frequencyMinutes);
  const values: number[] = [];
  for (let minute = 0; minute < 24 * 60; minute += safeFrequency) {
    values.push(minute);
  }
  return values;
}

function mergeMinutes(base: number[], extra: number[]) {
  return [...new Set([...base, ...extra])].sort((a, b) => a - b);
}

function backupTimesForDay(configVersion: DatabaseConfigVersion, weekday: number) {
  if (!configVersion.enabled) return [] as number[];
  const intervalTimes = occurrenceMinutesFromFrequency(configVersion.backup_frequency_minutes);
  const weekdayTimes = (configVersion.backup_days_of_week ?? []).includes(weekday) ? [0] : [];
  return mergeMinutes(intervalTimes, weekdayTimes);
}

function replicationTimesForDay(policyVersion: ReplicationPolicyVersion, weekday: number, sourceBackupTimes: number[]) {
  if (!policyVersion.enabled) return [] as number[];
  const hasInterval = policyVersion.replication_frequency_minutes != null && policyVersion.replication_frequency_minutes > 0;
  const hasWeekdays = (policyVersion.replication_days_of_week ?? []).includes(weekday);

  if (policyVersion.replication_frequency_minutes == null && (policyVersion.replication_days_of_week ?? []).length === 0) {
    return sourceBackupTimes;
  }

  const intervalTimes = hasInterval
    ? occurrenceMinutesFromFrequency(policyVersion.replication_frequency_minutes ?? 0)
    : [];
  const weekdayTimes = hasWeekdays ? [0] : [];
  return mergeMinutes(intervalTimes, weekdayTimes);
}

function restoreTimesForDay(restoreVersion: RestoreConfigVersion, weekday: number) {
  if (!restoreVersion.enabled) return [] as number[];
  const intervalTimes = occurrenceMinutesFromFrequency(restoreVersion.restore_frequency_minutes);
  const weekdayTimes = (restoreVersion.restore_days_of_week ?? []).includes(weekday) ? [0] : [];
  return mergeMinutes(intervalTimes, weekdayTimes);
}

/* ------------------------------------------------------------------ */
/*  Kanban Card                                                       */
/* ------------------------------------------------------------------ */

function KanbanCard({ event, index }: { event: PlannedEvent; index: number }) {
  const colors = EVENT_COLORS[event.type];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.25 }}
      className={`rounded-xl border ${colors.border} ${colors.bg} p-3 shadow-sm transition-shadow hover:shadow-md`}
    >
      <p className="text-[11px] font-medium text-muted-foreground">{formatTime(event.minuteOfDay)}</p>
      <p className={`mt-1 text-sm font-semibold ${colors.text}`}>{event.dbName ?? event.label}</p>
      {event.targetName && (
        <p className="mt-0.5 text-xs text-muted-foreground">→ {event.targetName}</p>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Kanban Column                                                     */
/* ------------------------------------------------------------------ */

function KanbanColumn({
  title,
  icon,
  events,
  type,
}: {
  title: string;
  icon: React.ReactNode;
  events: PlannedEvent[];
  type: PlannedEventType;
}) {
  const colors = EVENT_COLORS[type];
  return (
    <div className="flex flex-1 flex-col rounded-2xl border border-border bg-white shadow-soft">
      {/* Column header */}
      <div className={`flex items-center gap-2 rounded-t-2xl border-b ${colors.border} ${colors.bg} px-4 py-3`}>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${colors.badge}`}>
          {icon}
        </span>
        <h3 className={`text-sm font-bold ${colors.text}`}>{title}</h3>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${colors.badge}`}>
          {events.length}
        </span>
      </div>
      {/* Cards */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3" style={{ maxHeight: "60vh" }}>
        {events.length > 0 ? (
          events.map((event, idx) => <KanbanCard key={`${event.minuteOfDay}-${idx}`} event={event} index={idx} />)
        ) : (
          <p className="py-8 text-center text-xs text-muted-foreground">No events</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page Component                                               */
/* ------------------------------------------------------------------ */

export function PlannedEventsPage() {
  const { accessToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [backups, setBackups] = useState<Backup[]>([]);
  const [restoreJobs, setRestoreJobs] = useState<RestoreJob[]>([]);
  const [configVersions, setConfigVersions] = useState<DatabaseConfigVersion[]>([]);
  const [replicationPolicyVersions, setReplicationPolicyVersions] = useState<ReplicationPolicyVersion[]>([]);
  const [restoreConfigVersions, setRestoreConfigVersions] = useState<RestoreConfigVersion[]>([]);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [storageHosts, setStorageHosts] = useState<StorageHost[]>([]);

  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 5;
    const maxYear = currentYear + 5;
    const years: number[] = [];
    for (let year = minYear; year <= maxYear; year += 1) {
      years.push(year);
    }
    return years;
  }, []);

  const dbById = useMemo(() => new Map(databases.map((db) => [db.id, db])), [databases]);
  const hostById = useMemo(() => new Map(storageHosts.map((host) => [host.id, host])), [storageHosts]);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);

    void Promise.all([
      getBackups(accessToken),
      getRestoreJobs(accessToken),
      getConfigVersions(accessToken),
      getReplicationPolicyVersions(accessToken),
      getRestoreConfigVersions(accessToken),
      getDatabases(accessToken),
      getStorageHosts(accessToken),
    ])
      .then(([backupRows, restoreRows, configVersionRows, policyVersionRows, restoreVersionRows, databaseRows, hostRows]) => {
        setBackups(backupRows);
        setRestoreJobs(restoreRows);
        setConfigVersions(configVersionRows);
        setReplicationPolicyVersions(policyVersionRows);
        setRestoreConfigVersions(restoreVersionRows);
        setDatabases(databaseRows);
        setStorageHosts(hostRows);
      })
      .catch(() => {
        setError("Unable to load planned events.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [accessToken]);

  const dayStatusMap = useMemo(() => {
    const status = new Map<string, DayStatus>();

    const addStatus = (date: Date | null, isFailure: boolean) => {
      if (!date) return;
      const key = dayKey(date);
      const current = status.get(key) ?? { total: 0, failed: 0 };
      current.total += 1;
      if (isFailure) current.failed += 1;
      status.set(key, current);
    };

    for (const backup of backups) {
      const backupDate = parseDate(backup.completed_at) ?? parseDate(backup.started_at);
      addStatus(backupDate, backup.status === "FAILED");
      for (const replication of backup.replications) {
        const replicationDate = parseDate(replication.completed_at) ?? parseDate(replication.started_at);
        addStatus(replicationDate, replication.status === "FAILED");
      }
    }

    for (const restoreJob of restoreJobs) {
      const restoreDate = parseDate(restoreJob.completed_at) ?? parseDate(restoreJob.started_at);
      addStatus(restoreDate, restoreJob.status === "FAILED");
    }

    return status;
  }, [backups, restoreJobs]);

  const monthDays = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = toConfigWeekday(new Date(year, month, 1).getDay());

    const days: Array<Date | null> = [];
    for (let i = 0; i < firstWeekday; i += 1) {
      days.push(null);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      days.push(new Date(year, month, day));
    }
    while (days.length % 7 !== 0) {
      days.push(null);
    }
    return days;
  }, [monthCursor]);

  const daySummaryMap = useMemo(() => {
    const result = new Map<string, DaySummary>();

    const monthStart = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
    const monthEnd = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);

    for (let day = 1; day <= monthEnd.getDate(); day += 1) {
      const date = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), day);
      const weekday = toConfigWeekday(date.getDay());

      let backupsPlanned = 0;
      let replicationsPlanned = 0;
      let restoresPlanned = 0;

      const backupTimesByConfig = new Map<number, number[]>();
      const activeBackupVersions = configVersions.filter((version) => isVersionActiveOnDate(version, date));
      for (const configVersion of activeBackupVersions) {
        const times = backupTimesForDay(configVersion, weekday);
        backupTimesByConfig.set(configVersion.database_config, times);
        backupsPlanned += times.length;
      }

      const activeReplicationVersions = replicationPolicyVersions.filter((version) => isVersionActiveOnDate(version, date));
      for (const policyVersion of activeReplicationVersions) {
        const sourceBackupTimes = backupTimesByConfig.get(policyVersion.database_config) ?? [];
        const times = replicationTimesForDay(policyVersion, weekday, sourceBackupTimes);
        replicationsPlanned += times.length;
      }

      const activeRestoreVersions = restoreConfigVersions.filter((version) => isVersionActiveOnDate(version, date));
      for (const restoreVersion of activeRestoreVersions) {
        const targetDb = dbById.get(restoreVersion.target_database);
        if (!targetDb?.is_active) continue;
        const times = restoreTimesForDay(restoreVersion, weekday);
        restoresPlanned += times.length;
      }

      const key = dayKey(date);
      result.set(key, {
        date,
        backups: backupsPlanned,
        replications: replicationsPlanned,
        restores: restoresPlanned,
      });
    }

    for (const [key, value] of [...result.entries()]) {
      if (value.date < monthStart || value.date > monthEnd) {
        result.delete(key);
      }
    }

    return result;
  }, [monthCursor, configVersions, replicationPolicyVersions, restoreConfigVersions, dbById]);

  const selectedDaySummary = useMemo(() => {
    if (!selectedDate) return null;
    return daySummaryMap.get(dayKey(selectedDate)) ?? null;
  }, [selectedDate, daySummaryMap]);

  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return { backup: [], restore: [], replication: [] } as Record<PlannedEventType, PlannedEvent[]>;
    const weekday = toConfigWeekday(selectedDate.getDay());

    const events: Record<PlannedEventType, PlannedEvent[]> = { backup: [], restore: [], replication: [] };
    const activeBackupVersionByConfig = new Map<number, DatabaseConfigVersion>();
    const backupTimesByConfig = new Map<number, number[]>();

    for (const configVersion of configVersions.filter((version) => isVersionActiveOnDate(version, selectedDate))) {
      activeBackupVersionByConfig.set(configVersion.database_config, configVersion);
      const db = dbById.get(configVersion.database);
      const dbName = db ? `${db.name} (${db.db_type})` : `Config ${configVersion.database_config}`;
      const times = backupTimesForDay(configVersion, weekday);
      backupTimesByConfig.set(configVersion.database_config, times);
      for (const minuteOfDay of times) {
        events.backup.push({ type: "backup", minuteOfDay, label: `${dbName} backup`, dbName });
      }
    }

    for (const policyVersion of replicationPolicyVersions.filter((version) => isVersionActiveOnDate(version, selectedDate))) {
      const sourceBackupVersion = activeBackupVersionByConfig.get(policyVersion.database_config);
      const sourceDb = sourceBackupVersion ? dbById.get(sourceBackupVersion.database) : undefined;
      const sourceName = sourceDb ? `${sourceDb.name} (${sourceDb.db_type})` : `Config ${policyVersion.database_config}`;
      const hostName = hostById.get(policyVersion.storage_host)?.name ?? `Host ${policyVersion.storage_host}`;
      const sourceBackupTimes = backupTimesByConfig.get(policyVersion.database_config) ?? [];
      const times = replicationTimesForDay(policyVersion, weekday, sourceBackupTimes);
      for (const minuteOfDay of times) {
        events.replication.push({ type: "replication", minuteOfDay, label: `${sourceName} → ${hostName}`, dbName: sourceName, targetName: hostName });
      }
    }

    for (const restoreVersion of restoreConfigVersions.filter((version) => isVersionActiveOnDate(version, selectedDate))) {
      const sourceBackupVersion = activeBackupVersionByConfig.get(restoreVersion.source_config);
      const sourceDb = sourceBackupVersion ? dbById.get(sourceBackupVersion.database) : undefined;
      const targetDb = dbById.get(restoreVersion.target_database);
      if (!targetDb?.is_active) continue;
      const sourceName = sourceDb ? `${sourceDb.name} (${sourceDb.db_type})` : `Config ${restoreVersion.source_config}`;
      const targetName = `${targetDb.name} (${targetDb.db_type})`;
      const times = restoreTimesForDay(restoreVersion, weekday);
      for (const minuteOfDay of times) {
        events.restore.push({ type: "restore", minuteOfDay, label: `${sourceName} → ${targetName}`, dbName: sourceName, targetName });
      }
    }

    events.backup.sort((a, b) => a.minuteOfDay - b.minuteOfDay);
    events.restore.sort((a, b) => a.minuteOfDay - b.minuteOfDay);
    events.replication.sort((a, b) => a.minuteOfDay - b.minuteOfDay);

    return events;
  }, [selectedDate, configVersions, replicationPolicyVersions, restoreConfigVersions, dbById, hostById]);

  const todayStart = startOfDay(new Date());
  const today = new Date();
  const todayKey = dayKey(today);

  /* --- Calendar View ---------------------------------------------------- */
  if (!selectedDate) {
    return (
      <Section label="planner" title="Planned Events">
        {/* Month / Year navigation */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-gradient-to-r from-white to-muted/40 p-4 shadow-soft">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-white text-foreground shadow-sm transition hover:bg-muted"
            onClick={() => {
              setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
            }}
          >
            ‹
          </button>

          <select
            className="h-9 rounded-xl border border-border bg-white px-3 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            value={monthCursor.getMonth()}
            onChange={(e) => {
              const month = Number(e.target.value);
              setMonthCursor((prev) => new Date(prev.getFullYear(), month, 1));
            }}
          >
            {MONTH_OPTIONS.map((month, idx) => (
              <option key={month} value={idx}>{month}</option>
            ))}
          </select>

          <select
            className="h-9 rounded-xl border border-border bg-white px-3 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            value={monthCursor.getFullYear()}
            onChange={(e) => {
              const year = Number(e.target.value);
              setMonthCursor((prev) => new Date(year, prev.getMonth(), 1));
            }}
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>

          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-white text-foreground shadow-sm transition hover:bg-muted"
            onClick={() => {
              setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
            }}
          >
            ›
          </button>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const now = new Date();
              setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            Today
          </Button>

          {/* Legend */}
          <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-full ${EVENT_COLORS.backup.dot}`} /> Backups</span>
            <span className="flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-full ${EVENT_COLORS.restore.dot}`} /> Restorations</span>
            <span className="flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-full ${EVENT_COLORS.replication.dot}`} /> Replications</span>
          </div>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading planned events…</p>}
        {error && <p className="text-sm text-failure">{error}</p>}

        {/* Calendar grid */}
        <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
          {/* Weekday header row */}
          <div className="grid grid-cols-7 border-b border-border bg-gradient-to-r from-slate-50 to-slate-100">
            {WEEKDAY_HEADERS.map((day, i) => (
              <p key={day} className={`py-3 text-center text-xs font-bold uppercase tracking-widest ${i >= 5 ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
                {day}
              </p>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7">
            {monthDays.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="min-h-[7rem] border-b border-r border-border/50 bg-slate-50/50" />;
              }

              const key = dayKey(date);
              const summary = daySummaryMap.get(key);
              const status = dayStatusMap.get(key);
              const isToday = key === todayKey;
              const isPast = endOfDay(date) < todayStart;
              const showStatusDot = isPast && (status?.total ?? 0) > 0;
              const hasFailure = (status?.failed ?? 0) > 0;
              const totalEvents = (summary?.backups ?? 0) + (summary?.restores ?? 0) + (summary?.replications ?? 0);
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDate(date)}
                  className={`group relative min-h-[7rem] border-b border-r border-border/50 p-2 text-left transition-all duration-200 hover:z-10 hover:shadow-lg ${
                    isToday
                      ? "bg-accent/5 ring-2 ring-inset ring-accent/30"
                      : isWeekend
                        ? "bg-slate-50/70 hover:bg-white"
                        : "bg-white hover:bg-blue-50/30"
                  }`}
                >
                  {/* Day number + status */}
                  <div className="flex items-center justify-between">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                        isToday
                          ? "bg-accent text-white"
                          : isPast
                            ? "text-muted-foreground/60"
                            : "text-foreground group-hover:bg-accent/10 group-hover:text-accent"
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    {showStatusDot && (
                      <span className={`h-2 w-2 rounded-full ${hasFailure ? "bg-failure animate-pulse" : "bg-success"}`} />
                    )}
                  </div>

                  {/* Event indicator chips */}
                  {totalEvents > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(summary?.backups ?? 0) > 0 && (
                        <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${EVENT_COLORS.backup.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${EVENT_COLORS.backup.dot}`} />
                          {summary!.backups}
                        </span>
                      )}
                      {(summary?.restores ?? 0) > 0 && (
                        <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${EVENT_COLORS.restore.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${EVENT_COLORS.restore.dot}`} />
                          {summary!.restores}
                        </span>
                      )}
                      {(summary?.replications ?? 0) > 0 && (
                        <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${EVENT_COLORS.replication.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${EVENT_COLORS.replication.dot}`} />
                          {summary!.replications}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Activity bar at bottom */}
                  {totalEvents > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 flex h-1">
                      {(summary?.backups ?? 0) > 0 && <div className={`flex-1 ${EVENT_COLORS.backup.dot} opacity-40`} />}
                      {(summary?.restores ?? 0) > 0 && <div className={`flex-1 ${EVENT_COLORS.restore.dot} opacity-40`} />}
                      {(summary?.replications ?? 0) > 0 && <div className={`flex-1 ${EVENT_COLORS.replication.dot} opacity-40`} />}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Section>
    );
  }

  /* --- Kanban Day Detail View ------------------------------------------- */
  const weekdayName = WEEKDAY_FULL[toConfigWeekday(selectedDate.getDay())];

  return (
    <Section label="planner" title="Planned Events">
      {/* Back button + day header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-gradient-to-r from-white to-muted/40 p-4 shadow-soft"
      >
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setSelectedDate(null)}
        >
          ← Back to Calendar
        </Button>

        <div className="flex-1">
          <h3 className="font-headline text-xl text-foreground">
            {weekdayName}, {MONTH_OPTIONS[selectedDate.getMonth()]} {selectedDate.getDate()}, {selectedDate.getFullYear()}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {selectedDaySummary?.backups ?? 0} backups · {selectedDaySummary?.restores ?? 0} restorations · {selectedDaySummary?.replications ?? 0} replications
          </p>
        </div>

        {/* Summary badges */}
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${EVENT_COLORS.backup.badge}`}>
            {selectedDayEvents.backup.length} Backups
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${EVENT_COLORS.restore.badge}`}>
            {selectedDayEvents.restore.length} Restorations
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${EVENT_COLORS.replication.badge}`}>
            {selectedDayEvents.replication.length} Replications
          </span>
        </div>
      </motion.div>

      {/* Kanban columns */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
      >
        <KanbanColumn
          title="Backups"
          type="backup"
          events={selectedDayEvents.backup}
          icon={
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M4 7c0-2 1-3 3-3h10c2 0 3 1 3 3M4 7h16M8 11h.01M12 11h.01M16 11h.01" />
            </svg>
          }
        />
        <KanbanColumn
          title="Restorations"
          type="restore"
          events={selectedDayEvents.restore}
          icon={
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          }
        />
        <KanbanColumn
          title="Replications"
          type="replication"
          events={selectedDayEvents.replication}
          icon={
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          }
        />
      </motion.div>
    </Section>
  );
}
