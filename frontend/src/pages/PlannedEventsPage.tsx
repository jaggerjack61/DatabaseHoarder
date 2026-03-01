import { useMemo, useState, useEffect } from "react";

import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";
import { Table, TableWrapper } from "@/components/ui/Table";
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

  const selectedDayEventsByHour = useMemo(() => {
    if (!selectedDate) return [] as Array<{ hour: number; events: PlannedEvent[] }>;
    const weekday = toConfigWeekday(selectedDate.getDay());

    const allEvents: PlannedEvent[] = [];
    const activeBackupVersionByConfig = new Map<number, DatabaseConfigVersion>();
    const backupTimesByConfig = new Map<number, number[]>();

    for (const configVersion of configVersions.filter((version) => isVersionActiveOnDate(version, selectedDate))) {
      activeBackupVersionByConfig.set(configVersion.database_config, configVersion);
      const db = dbById.get(configVersion.database);
      const dbName = db ? `${db.name} (${db.db_type})` : `Config ${configVersion.database_config}`;
      const times = backupTimesForDay(configVersion, weekday);
      backupTimesByConfig.set(configVersion.database_config, times);
      for (const minuteOfDay of times) {
        allEvents.push({ type: "backup", minuteOfDay, label: `${dbName} backup` });
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
        allEvents.push({ type: "replication", minuteOfDay, label: `${sourceName} → ${hostName} replication` });
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
        allEvents.push({ type: "restore", minuteOfDay, label: `${sourceName} → ${targetName} restore` });
      }
    }

    const grouped = Array.from({ length: 24 }, (_, hour) => ({ hour, events: [] as PlannedEvent[] }));
    allEvents
      .sort((a, b) => a.minuteOfDay - b.minuteOfDay)
      .forEach((event) => {
        const hour = Math.floor(event.minuteOfDay / 60);
        grouped[hour].events.push(event);
      });

    return grouped.filter((entry) => entry.events.length > 0);
  }, [selectedDate, configVersions, replicationPolicyVersions, restoreConfigVersions, dbById, hostById]);

  const todayStart = startOfDay(new Date());

  return (
    <Section label="planner" title="Planned Events">
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-muted/30 p-3">
        <p className="text-sm font-medium text-foreground">Month</p>
        <select
          className="h-9 rounded-xl border border-border bg-white px-3 text-sm shadow-soft"
          value={monthCursor.getMonth()}
          onChange={(e) => {
            const month = Number(e.target.value);
            setMonthCursor((prev) => new Date(prev.getFullYear(), month, 1));
            setSelectedDate(null);
          }}
        >
          {MONTH_OPTIONS.map((month, idx) => (
            <option key={month} value={idx}>{month}</option>
          ))}
        </select>

        <p className="text-sm font-medium text-foreground">Year</p>
        <select
          className="h-9 rounded-xl border border-border bg-white px-3 text-sm shadow-soft"
          value={monthCursor.getFullYear()}
          onChange={(e) => {
            const year = Number(e.target.value);
            setMonthCursor((prev) => new Date(year, prev.getMonth(), 1));
            setSelectedDate(null);
          }}
        >
          {yearOptions.map((year) => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>

        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const now = new Date();
            setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
            setSelectedDate(null);
          }}
        >
          Current Month
        </Button>
      </div>

      {loading && <p className="mb-4 text-sm text-muted-foreground">Loading planned events...</p>}
      {error && <p className="mb-4 text-sm text-failure">{error}</p>}

      <div className="rounded-2xl border border-border bg-white p-3 shadow-soft">
        <div className="grid grid-cols-7 gap-2">
          {WEEKDAY_HEADERS.map((day) => (
            <p key={day} className="px-2 py-1 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {day}
            </p>
          ))}

          {monthDays.map((date, index) => {
            if (!date) {
              return <div key={`empty-${index}`} className="h-24 rounded-lg border border-transparent" />;
            }

            const key = dayKey(date);
            const summary = daySummaryMap.get(key);
            const status = dayStatusMap.get(key);
            const isSelected = selectedDate != null && dayKey(selectedDate) === key;
            const isPast = endOfDay(date) < todayStart;
            const showStatusDot = isPast && (status?.total ?? 0) > 0;
            const hasFailure = (status?.failed ?? 0) > 0;

            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedDate(date)}
                className={`h-24 rounded-lg border p-2 text-left transition ${
                  isSelected
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-accent/40 hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{date.getDate()}</p>
                  {showStatusDot && (
                    <span className={`h-2.5 w-2.5 rounded-full ${hasFailure ? "bg-failure" : "bg-success"}`} />
                  )}
                </div>
                <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                  <p>B: {summary?.backups ?? 0}</p>
                  <p>R: {summary?.restores ?? 0}</p>
                  <p>P: {summary?.replications ?? 0}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-white p-4 shadow-soft">
        <p className="text-sm font-medium text-foreground">Day Timeline</p>
        {selectedDate ? (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedDate.toLocaleDateString()} · Planned backups {selectedDaySummary?.backups ?? 0}, restores {selectedDaySummary?.restores ?? 0}, replications {selectedDaySummary?.replications ?? 0}
            </p>

            <TableWrapper className="mt-3">
              <Table>
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3">Hour</th>
                    <th className="px-4 py-3">Planned Events</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDayEventsByHour.map((entry) => (
                    <tr key={entry.hour} className="border-b border-border/70 hover:bg-muted/50">
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {String(entry.hour).padStart(2, "0")}:00
                      </td>
                      <td className="px-4 py-2">
                        <div className="space-y-1">
                          {entry.events.map((event, idx) => (
                            <p key={`${entry.hour}-${idx}`} className="text-xs text-foreground">
                              <span className="mr-2 text-muted-foreground">{formatTime(event.minuteOfDay)}</span>
                              <span className="uppercase tracking-wide text-muted-foreground">{event.type}</span>
                              <span className="mx-2 text-muted-foreground">•</span>
                              {event.label}
                            </p>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrapper>

            {selectedDayEventsByHour.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">No planned events for this date.</p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Click a date to see hour-by-hour planned events.</p>
        )}
      </div>
    </Section>
  );
}
