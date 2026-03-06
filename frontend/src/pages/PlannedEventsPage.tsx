import { type ReactNode, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Section } from "@/components/ui/Section";
import { useAuth } from "@/context/AuthContext";
import {
  createConfig,
  createReplicationPolicy,
  createRestoreConfig,
  getBackups,
  getConfigs,
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
  DatabaseConfig,
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
  isOneTime?: boolean;
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

type EventGroups = {
  scheduled: Record<PlannedEventType, PlannedEvent[]>;
  oneTime: Record<PlannedEventType, PlannedEvent[]>;
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

function isVersionActiveOnDate(value: { effective_from: string; effective_to: string | null }, date: Date) {
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

function emptyEventGroups(): EventGroups {
  return {
    scheduled: { backup: [], restore: [], replication: [] },
    oneTime: { backup: [], restore: [], replication: [] },
  };
}

function KanbanCard({ event, index }: { event: PlannedEvent; index: number }) {
  const colors = EVENT_COLORS[event.type];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.25 }}
      className={`rounded-xl ${event.isOneTime ? "border-2 border-dashed" : "border"} ${colors.border} ${colors.bg} p-3 shadow-sm transition-shadow hover:shadow-md`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">{event.isOneTime ? "One-time event" : formatTime(event.minuteOfDay)}</p>
          <p className={`mt-1 text-sm font-semibold ${colors.text}`}>{event.dbName ?? event.label}</p>
        </div>
        {event.isOneTime && (
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${colors.badge}`}>
            One-time
          </span>
        )}
      </div>
      {event.targetName && <p className="mt-0.5 text-xs text-muted-foreground">→ {event.targetName}</p>}
    </motion.div>
  );
}

function AddEventModal({
  open,
  type,
  selectedDate,
  accessToken,
  databases,
  configs,
  storageHosts,
  dbById,
  onClose,
  onCreated,
}: {
  open: boolean;
  type: PlannedEventType;
  selectedDate: Date;
  accessToken: string;
  databases: Database[];
  configs: DatabaseConfig[];
  storageHosts: StorageHost[];
  dbById: Map<number, Database>;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [backupDatabaseId, setBackupDatabaseId] = useState(0);
  const [backupRetentionDays, setBackupRetentionDays] = useState(7);
  const [restoreSourceConfigId, setRestoreSourceConfigId] = useState(0);
  const [restoreTargetDatabaseId, setRestoreTargetDatabaseId] = useState(0);
  const [dropTargetOnSuccess, setDropTargetOnSuccess] = useState(false);
  const [replicationConfigId, setReplicationConfigId] = useState(0);
  const [replicationStorageHostId, setReplicationStorageHostId] = useState(0);
  const [replicationRemotePath, setReplicationRemotePath] = useState("/backups");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const typeLabel = type === "backup" ? "Backup" : type === "restore" ? "Restoration" : "Replication";
  const weekday = toConfigWeekday(selectedDate.getDay());
  const scheduleForDate = dayKey(selectedDate);

  const activeDatabases = useMemo(() => databases.filter((database) => database.is_active), [databases]);
  const availableSourceConfigs = useMemo(
    () => configs.filter((config) => !config.is_one_time_event && config.enabled),
    [configs],
  );

  const restoreTargetOptions = useMemo(() => {
    const sourceConfig = availableSourceConfigs.find((config) => config.id === restoreSourceConfigId);
    const sourceDatabase = sourceConfig ? dbById.get(sourceConfig.database) : undefined;
    if (!sourceDatabase) return activeDatabases;
    return activeDatabases.filter((database) => database.db_type === sourceDatabase.db_type);
  }, [activeDatabases, availableSourceConfigs, dbById, restoreSourceConfigId]);

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setSubmitting(false);
    setBackupDatabaseId(activeDatabases[0]?.id ?? 0);
    setBackupRetentionDays(7);
    setRestoreSourceConfigId(availableSourceConfigs[0]?.id ?? 0);
    setRestoreTargetDatabaseId(restoreTargetOptions[0]?.id ?? activeDatabases[0]?.id ?? 0);
    setDropTargetOnSuccess(false);
    setReplicationConfigId(availableSourceConfigs[0]?.id ?? 0);
    setReplicationStorageHostId(storageHosts[0]?.id ?? 0);
    setReplicationRemotePath("/backups");
  }, [open, activeDatabases, availableSourceConfigs, restoreTargetOptions, storageHosts, type]);

  useEffect(() => {
    if (!restoreTargetOptions.some((database) => database.id === restoreTargetDatabaseId)) {
      setRestoreTargetDatabaseId(restoreTargetOptions[0]?.id ?? 0);
    }
  }, [restoreTargetDatabaseId, restoreTargetOptions]);

  const configLabel = (config: DatabaseConfig) => {
    const database = dbById.get(config.database);
    return database ? `${database.name} (${database.db_type})` : `Config ${config.id}`;
  };

  const close = () => {
    if (submitting) return;
    setSubmitError(null);
    onClose();
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    setSubmitting(true);

    try {
      if (type === "backup") {
        if (!backupDatabaseId) throw new Error("Choose a database for the backup event.");
        await createConfig(accessToken, {
          database: backupDatabaseId,
          backup_frequency_minutes: 0,
          retention_days: Math.max(1, backupRetentionDays),
          backup_days_of_week: [weekday],
          retention_keep_monthly_first: false,
          retention_keep_weekly_day: null,
          retention_exception_days: null,
          retention_exception_max_days: null,
          enabled: true,
          schedule_for_date: scheduleForDate,
          is_one_time_event: true,
        });
      }

      if (type === "restore") {
        if (!restoreSourceConfigId) throw new Error("Choose a source backup config.");
        if (!restoreTargetDatabaseId) throw new Error("Choose a target database.");
        await createRestoreConfig(accessToken, {
          source_config: restoreSourceConfigId,
          target_database: restoreTargetDatabaseId,
          restore_frequency_minutes: 0,
          restore_days_of_week: [weekday],
          drop_target_on_success: dropTargetOnSuccess,
          enabled: true,
          schedule_for_date: scheduleForDate,
          is_one_time_event: true,
        });
      }

      if (type === "replication") {
        if (!replicationConfigId) throw new Error("Choose a source backup config.");
        if (!replicationStorageHostId) throw new Error("Choose a storage host.");
        if (!replicationRemotePath.trim()) throw new Error("Remote path is required.");
        await createReplicationPolicy(accessToken, {
          database_config: replicationConfigId,
          storage_host: replicationStorageHostId,
          remote_path: replicationRemotePath.trim(),
          enabled: true,
          replication_frequency_minutes: null,
          replication_days_of_week: [weekday],
          replication_retention_days: null,
          replication_retention_exception_days: null,
          replication_retention_exception_max_days: null,
          schedule_for_date: scheduleForDate,
          is_one_time_event: true,
        });
      }

      await onCreated();
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : `Failed to create ${typeLabel.toLowerCase()} event.`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} title={`Add ${typeLabel} Event`} onClose={close}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Create a hidden one-day {typeLabel.toLowerCase()} config for {MONTH_OPTIONS[selectedDate.getMonth()]} {selectedDate.getDate()}, {selectedDate.getFullYear()}.
        </p>

        {type === "backup" && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Database</label>
              <select
                value={backupDatabaseId}
                onChange={(event) => setBackupDatabaseId(Number(event.target.value))}
                className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {activeDatabases.map((database) => (
                  <option key={database.id} value={database.id}>{database.name} ({database.db_type})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Retention Days</label>
              <input
                type="number"
                min={1}
                value={backupRetentionDays}
                onChange={(event) => setBackupRetentionDays(Number(event.target.value))}
                className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </>
        )}

        {type === "restore" && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Source Backup Config</label>
              <select
                value={restoreSourceConfigId}
                onChange={(event) => setRestoreSourceConfigId(Number(event.target.value))}
                className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {availableSourceConfigs.map((config) => (
                  <option key={config.id} value={config.id}>{configLabel(config)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Target Database</label>
              <select
                value={restoreTargetDatabaseId}
                onChange={(event) => setRestoreTargetDatabaseId(Number(event.target.value))}
                className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {restoreTargetOptions.map((database) => (
                  <option key={database.id} value={database.id}>{database.name} ({database.db_type})</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-sm text-foreground shadow-sm">
              <input
                type="checkbox"
                checked={dropTargetOnSuccess}
                onChange={(event) => setDropTargetOnSuccess(event.target.checked)}
              />
              Drop target after successful restore
            </label>
          </>
        )}

        {type === "replication" && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Source Backup Config</label>
              <select
                value={replicationConfigId}
                onChange={(event) => setReplicationConfigId(Number(event.target.value))}
                className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {availableSourceConfigs.map((config) => (
                  <option key={config.id} value={config.id}>{configLabel(config)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Storage Host</label>
              <select
                value={replicationStorageHostId}
                onChange={(event) => setReplicationStorageHostId(Number(event.target.value))}
                className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {storageHosts.map((host) => (
                  <option key={host.id} value={host.id}>{host.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Remote Path</label>
              <input
                type="text"
                value={replicationRemotePath}
                onChange={(event) => setReplicationRemotePath(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </>
        )}

        {submitError && <p className="text-sm text-failure">{submitError}</p>}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "Creating…" : `Add ${typeLabel} Event`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function KanbanColumn({
  title,
  icon,
  type,
  scheduledEvents,
  oneTimeEvents,
  onAddEvent,
}: {
  title: string;
  icon: ReactNode;
  type: PlannedEventType;
  scheduledEvents: PlannedEvent[];
  oneTimeEvents: PlannedEvent[];
  onAddEvent: () => void;
}) {
  const colors = EVENT_COLORS[type];
  const totalCount = scheduledEvents.length + oneTimeEvents.length;

  return (
    <div className="flex flex-1 flex-col rounded-2xl border border-border bg-white shadow-soft">
      <div className={`flex flex-wrap items-center gap-2 rounded-t-2xl border-b ${colors.border} ${colors.bg} px-4 py-3`}>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${colors.badge}`}>{icon}</span>
        <h3 className={`text-sm font-bold ${colors.text}`}>{title}</h3>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${colors.badge}`}>{totalCount}</span>
        <Button size="sm" variant="secondary" className="border-white/70 bg-white/80" onClick={onAddEvent}>
          + Add Event
        </Button>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3" style={{ maxHeight: "60vh" }}>
        {totalCount > 0 ? (
          <>
            {scheduledEvents.map((event, index) => (
              <KanbanCard key={`${event.type}-${event.label}-${event.minuteOfDay}-${index}`} event={event} index={index} />
            ))}
            {oneTimeEvents.length > 0 && (
              <div className="mt-2 border-t border-dashed border-border/80 pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">One-Time Entries</p>
                <div className="flex flex-col gap-2">
                  {oneTimeEvents.map((event, index) => (
                    <KanbanCard key={`${event.type}-${event.label}-${event.minuteOfDay}-${index}`} event={event} index={scheduledEvents.length + index} />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="py-8 text-center text-xs text-muted-foreground">No events</p>
        )}
      </div>
    </div>
  );
}

export function PlannedEventsPage() {
  const { accessToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [backups, setBackups] = useState<Backup[]>([]);
  const [restoreJobs, setRestoreJobs] = useState<RestoreJob[]>([]);
  const [configs, setConfigs] = useState<DatabaseConfig[]>([]);
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
  const [addModalType, setAddModalType] = useState<PlannedEventType | null>(null);

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

  const loadPlannerData = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);

    try {
      const [
        backupRows,
        restoreRows,
        configRows,
        configVersionRows,
        policyVersionRows,
        restoreVersionRows,
        databaseRows,
        hostRows,
      ] = await Promise.all([
        getBackups(accessToken),
        getRestoreJobs(accessToken),
        getConfigs(accessToken),
        getConfigVersions(accessToken),
        getReplicationPolicyVersions(accessToken),
        getRestoreConfigVersions(accessToken),
        getDatabases(accessToken),
        getStorageHosts(accessToken),
      ]);

      setBackups(backupRows);
      setRestoreJobs(restoreRows);
      setConfigs(configRows);
      setConfigVersions(configVersionRows);
      setReplicationPolicyVersions(policyVersionRows);
      setRestoreConfigVersions(restoreVersionRows);
      setDatabases(databaseRows);
      setStorageHosts(hostRows);
    } catch {
      setError("Unable to load planned events.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPlannerData();
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
    for (let index = 0; index < firstWeekday; index += 1) {
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
        restoresPlanned += restoreTimesForDay(restoreVersion, weekday).length;
      }

      result.set(dayKey(date), {
        date,
        backups: backupsPlanned,
        replications: replicationsPlanned,
        restores: restoresPlanned,
      });
    }

    return result;
  }, [monthCursor, configVersions, replicationPolicyVersions, restoreConfigVersions, dbById]);

  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return emptyEventGroups();

    const weekday = toConfigWeekday(selectedDate.getDay());
    const groups = emptyEventGroups();
    const activeBackupVersionByConfig = new Map<number, DatabaseConfigVersion>();
    const backupTimesByConfig = new Map<number, number[]>();

    for (const configVersion of configVersions.filter((version) => isVersionActiveOnDate(version, selectedDate))) {
      activeBackupVersionByConfig.set(configVersion.database_config, configVersion);
      const database = dbById.get(configVersion.database);
      const dbName = database ? `${database.name} (${database.db_type})` : `Config ${configVersion.database_config}`;
      const times = backupTimesForDay(configVersion, weekday);
      backupTimesByConfig.set(configVersion.database_config, times);
      for (const minuteOfDay of times) {
        const target = configVersion.is_one_time_event ? groups.oneTime.backup : groups.scheduled.backup;
        target.push({ type: "backup", minuteOfDay, label: `${dbName} backup`, dbName, isOneTime: configVersion.is_one_time_event });
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
        const target = policyVersion.is_one_time_event ? groups.oneTime.replication : groups.scheduled.replication;
        target.push({
          type: "replication",
          minuteOfDay,
          label: `${sourceName} → ${hostName}`,
          dbName: sourceName,
          targetName: hostName,
          isOneTime: policyVersion.is_one_time_event,
        });
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
        const target = restoreVersion.is_one_time_event ? groups.oneTime.restore : groups.scheduled.restore;
        target.push({
          type: "restore",
          minuteOfDay,
          label: `${sourceName} → ${targetName}`,
          dbName: sourceName,
          targetName,
          isOneTime: restoreVersion.is_one_time_event,
        });
      }
    }

    for (const eventType of ["backup", "restore", "replication"] as PlannedEventType[]) {
      groups.scheduled[eventType].sort((left, right) => left.minuteOfDay - right.minuteOfDay);
      groups.oneTime[eventType].sort((left, right) => left.minuteOfDay - right.minuteOfDay);
    }

    return groups;
  }, [selectedDate, configVersions, replicationPolicyVersions, restoreConfigVersions, dbById, hostById]);

  const selectedDayOneTimeCount =
    selectedDayEvents.oneTime.backup.length
    + selectedDayEvents.oneTime.restore.length
    + selectedDayEvents.oneTime.replication.length;

  const todayStart = startOfDay(new Date());
  const today = new Date();
  const todayKey = dayKey(today);

  if (!selectedDate) {
    return (
      <Section label="planner" title="Planned Events">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-gradient-to-r from-white to-muted/40 p-4 shadow-soft">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-white text-foreground shadow-sm transition hover:bg-muted"
            onClick={() => setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
          >
            ‹
          </button>

          <select
            className="h-9 rounded-xl border border-border bg-white px-3 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            value={monthCursor.getMonth()}
            onChange={(event) => setMonthCursor((prev) => new Date(prev.getFullYear(), Number(event.target.value), 1))}
          >
            {MONTH_OPTIONS.map((month, index) => (
              <option key={month} value={index}>{month}</option>
            ))}
          </select>

          <select
            className="h-9 rounded-xl border border-border bg-white px-3 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            value={monthCursor.getFullYear()}
            onChange={(event) => setMonthCursor((prev) => new Date(Number(event.target.value), prev.getMonth(), 1))}
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>

          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-white text-foreground shadow-sm transition hover:bg-muted"
            onClick={() => setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
          >
            ›
          </button>

          <Button size="sm" variant="secondary" onClick={() => {
            const now = new Date();
            setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
          }}>
            Today
          </Button>

          <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-full ${EVENT_COLORS.backup.dot}`} /> Backups</span>
            <span className="flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-full ${EVENT_COLORS.restore.dot}`} /> Restorations</span>
            <span className="flex items-center gap-1"><span className={`inline-block h-2.5 w-2.5 rounded-full ${EVENT_COLORS.replication.dot}`} /> Replications</span>
          </div>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading planned events…</p>}
        {error && <p className="text-sm text-failure">{error}</p>}

        <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
          <div className="grid grid-cols-7 border-b border-border bg-gradient-to-r from-slate-50 to-slate-100">
            {WEEKDAY_HEADERS.map((day, index) => (
              <p key={day} className={`py-3 text-center text-xs font-bold uppercase tracking-widest ${index >= 5 ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
                {day}
              </p>
            ))}
          </div>

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
                  <div className="flex items-center justify-between">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                      isToday
                        ? "bg-accent text-white"
                        : isPast
                          ? "text-muted-foreground/60"
                          : "text-foreground group-hover:bg-accent/10 group-hover:text-accent"
                    }`}>
                      {date.getDate()}
                    </span>
                    {showStatusDot && <span className={`h-2 w-2 rounded-full ${hasFailure ? "bg-failure animate-pulse" : "bg-success"}`} />}
                  </div>

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

  const weekdayName = WEEKDAY_FULL[toConfigWeekday(selectedDate.getDay())];

  return (
    <Section label="planner" title="Planned Events">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-gradient-to-r from-white to-muted/40 p-4 shadow-soft"
      >
        <Button size="sm" variant="secondary" onClick={() => setSelectedDate(null)}>
          ← Back to Calendar
        </Button>

        <div className="flex-1">
          <h3 className="font-headline text-xl text-foreground">
            {weekdayName}, {MONTH_OPTIONS[selectedDate.getMonth()]} {selectedDate.getDate()}, {selectedDate.getFullYear()}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {selectedDayEvents.scheduled.backup.length} scheduled backups · {selectedDayEvents.scheduled.restore.length} scheduled restorations · {selectedDayEvents.scheduled.replication.length} scheduled replications
            {selectedDayOneTimeCount > 0 ? ` · ${selectedDayOneTimeCount} one-time entries` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${EVENT_COLORS.backup.badge}`}>
            {selectedDayEvents.scheduled.backup.length + selectedDayEvents.oneTime.backup.length} Backups
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${EVENT_COLORS.restore.badge}`}>
            {selectedDayEvents.scheduled.restore.length + selectedDayEvents.oneTime.restore.length} Restorations
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${EVENT_COLORS.replication.badge}`}>
            {selectedDayEvents.scheduled.replication.length + selectedDayEvents.oneTime.replication.length} Replications
          </span>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
      >
        <KanbanColumn
          title="Backups"
          type="backup"
          scheduledEvents={selectedDayEvents.scheduled.backup}
          oneTimeEvents={selectedDayEvents.oneTime.backup}
          onAddEvent={() => setAddModalType("backup")}
          icon={
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M4 7c0-2 1-3 3-3h10c2 0 3 1 3 3M4 7h16M8 11h.01M12 11h.01M16 11h.01" />
            </svg>
          }
        />
        <KanbanColumn
          title="Restorations"
          type="restore"
          scheduledEvents={selectedDayEvents.scheduled.restore}
          oneTimeEvents={selectedDayEvents.oneTime.restore}
          onAddEvent={() => setAddModalType("restore")}
          icon={
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          }
        />
        <KanbanColumn
          title="Replications"
          type="replication"
          scheduledEvents={selectedDayEvents.scheduled.replication}
          oneTimeEvents={selectedDayEvents.oneTime.replication}
          onAddEvent={() => setAddModalType("replication")}
          icon={
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          }
        />
      </motion.div>

      {selectedDate && addModalType && accessToken && (
        <AddEventModal
          open
          type={addModalType}
          selectedDate={selectedDate}
          accessToken={accessToken}
          databases={databases}
          configs={configs}
          storageHosts={storageHosts}
          dbById={dbById}
          onClose={() => setAddModalType(null)}
          onCreated={loadPlannerData}
        />
      )}
    </Section>
  );
}
