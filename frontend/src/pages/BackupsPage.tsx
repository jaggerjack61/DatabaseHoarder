import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Section } from "@/components/ui/Section";
import { Table, TableWrapper } from "@/components/ui/Table";
import { useAuth } from "@/context/AuthContext";
import {
  deleteBackup,
  getBackupDeletionRequests,
  getBackups,
  getConfigs,
  getDatabases,
  getReplicationPolicies,
  getStorageHosts,
  replicateBackup,
  reviewBackupDeletionRequest,
  restoreBackup,
  triggerBackup,
} from "@/lib/api";
import { Backup, BackupDeletionRequest, Database, DatabaseConfig, ReplicationPolicy, StorageHost } from "@/types/api";

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, power);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[power]}`;
}

function StatusBadge({ status }: { status: Backup["status"] }) {
  if (status === "SUCCESS") return <Badge variant="success">Success</Badge>;
  if (status === "FAILED") return <Badge variant="failed">Failed</Badge>;
  if (status === "RUNNING") return (
    <Badge variant="running">
      <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />Running
    </Badge>
  );
  return <Badge variant="neutral">Pending</Badge>;
}

function formatScheduleTimestamp(value: Date | null) {
  if (!value) return "Not scheduled";
  return value.toLocaleString();
}

function toConfigWeekday(jsWeekday: number) {
  return (jsWeekday + 6) % 7;
}

function nextWeekdayOccurrence(activeDays: number[], now: Date) {
  if (activeDays.length === 0) return null;
  const today = toConfigWeekday(now.getDay());
  if (activeDays.includes(today)) {
    return new Date(now);
  }
  let closestOffset = 7;
  for (const day of activeDays) {
    const offset = (day - today + 7) % 7;
    if (offset !== 0 && offset < closestOffset) {
      closestOffset = offset;
    }
  }
  const next = new Date(now);
  next.setDate(next.getDate() + closestOffset);
  return next;
}

function minDate(a: Date | null, b: Date | null) {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

function findNextBackupOccurrence(config: DatabaseConfig | undefined, now: Date) {
  if (!config || !config.enabled) return null;

  const activeDays = config.backup_days_of_week ?? [];
  const dayNext = nextWeekdayOccurrence(activeDays, now);
  if (config.backup_frequency_minutes === 0) {
    return dayNext;
  }

  const frequencyMinutes = Math.max(1, config.backup_frequency_minutes || 1);
  const intervalMs = frequencyMinutes * 60 * 1000;
  const intervalStart = config.last_backup_at
    ? new Date(new Date(config.last_backup_at).getTime() + intervalMs)
    : new Date(now);
  const intervalNext = Number.isNaN(intervalStart.getTime()) ? null : intervalStart;
  return minDate(intervalNext, dayNext);
}

function findNextReplicationOccurrence(policy: ReplicationPolicy, now: Date, nextBackupAt: Date | null) {
  if (!policy.enabled) return null;
  if (policy.replication_frequency_minutes == null && policy.replication_days_of_week.length === 0) {
    return nextBackupAt;
  }

  const intervalNext = policy.replication_frequency_minutes == null || policy.replication_frequency_minutes === 0
    ? null
    : (() => {
        const frequencyMinutes = Math.max(1, policy.replication_frequency_minutes || 1);
        const intervalMs = frequencyMinutes * 60 * 1000;
        const start = policy.last_replicated_at
          ? new Date(new Date(policy.last_replicated_at).getTime() + intervalMs)
          : new Date(now);
        return Number.isNaN(start.getTime()) ? null : start;
      })();

  const dayNext = nextWeekdayOccurrence(policy.replication_days_of_week ?? [], now);
  return minDate(intervalNext, dayNext);
}

export function BackupsPage() {
  const { accessToken, user } = useAuth();

  // restore modal
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null);
  const [targetDb, setTargetDb] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // manual replication modal
  const [replicationOpen, setReplicationOpen] = useState(false);
  const [replicationBackup, setReplicationBackup] = useState<Backup | null>(null);
  const [selectedReplicationHosts, setSelectedReplicationHosts] = useState<Set<number>>(new Set());
  const [replicationError, setReplicationError] = useState<string | null>(null);
  const [replicating, setReplicating] = useState(false);

  // delete confirmation modal
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<"single" | "bulk">("single");
  const [deleting, setDeleting] = useState(false);
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleteReplications, setDeleteReplications] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // admin deletion request queue
  const [deletionRequests, setDeletionRequests] = useState<BackupDeletionRequest[]>([]);
  const [reviewingRequestId, setReviewingRequestId] = useState<number | null>(null);

  // multi-select
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());

  // data
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Backup[]>([]);
  const [configs, setConfigs] = useState<DatabaseConfig[]>([]);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [storageHosts, setStorageHosts] = useState<StorageHost[]>([]);
  const [replicationPolicies, setReplicationPolicies] = useState<ReplicationPolicy[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<number>(0);
  const [triggering, setTriggering] = useState(false);
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);

  const dbById = useMemo(() => new Map(databases.map((d) => [d.id, d])), [databases]);
  const configById = useMemo(() => new Map(configs.map((c) => [c.id, c])), [configs]);
  const storageHostById = useMemo(() => new Map(storageHosts.map((h) => [h.id, h])), [storageHosts]);

  const dbNameForConfig = (configId: number) => {
    const cfg = configById.get(configId);
    if (!cfg) return `Config ${configId}`;
    const db = dbById.get(cfg.database);
    return db?.name ?? `Database ${cfg.database}`;
  };

  const loadData = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [backups, cfgs, dbs, shs, policies] = await Promise.all([
        getBackups(accessToken),
        getConfigs(accessToken),
        getDatabases(accessToken),
        getStorageHosts(accessToken),
        getReplicationPolicies(accessToken),
      ]);
      setRows(backups);
      setConfigs(cfgs);
      setDatabases(dbs);
      setStorageHosts(shs);
      setReplicationPolicies(policies);
      if (user?.role === "ADMIN") {
        const requests = await getBackupDeletionRequests(accessToken);
        setDeletionRequests(requests);
      }
      if (cfgs.length > 0 && selectedConfigId === 0) {
        setSelectedConfigId(cfgs[0].id);
      }
    } catch {
      setError("Unable to load backups.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, [accessToken, user?.role]);

  // ── restore ────────────────────────────────────────────────────────────────
  const openRestore = (backup: Backup) => {
    setSelectedBackup(backup);
    setTargetDb("");
    setConfirmationPhrase("");
    setRestoreError(null);
    setRestoreOpen(true);
  };

  const submitRestore = async () => {
    if (!accessToken || !selectedBackup) return;
    setRestoreError(null);
    if (confirmationPhrase !== "CONFIRM RESTORE") {
      setRestoreError("Type exactly: CONFIRM RESTORE");
      return;
    }
    if (!targetDb.trim()) {
      setRestoreError("Target database / path is required.");
      return;
    }
    try {
      await restoreBackup(accessToken, selectedBackup.id, {
        target_db: targetDb,
        confirmation_phrase: confirmationPhrase,
      });
      setRestoreOpen(false);
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "Restore request failed.");
    }
  };

  // ── manual replication ────────────────────────────────────────────────────
  const replicationHostOptions = useMemo(() => {
    if (!replicationBackup) return [];
    const allowedPolicies = replicationPolicies.filter(
      (policy) => policy.enabled && policy.database_config === replicationBackup.database_config,
    );
    return allowedPolicies.map((policy) => ({
      storageHostId: policy.storage_host,
      remotePath: policy.remote_path,
      hostName: storageHostById.get(policy.storage_host)?.name ?? `Host ${policy.storage_host}`,
    }));
  }, [replicationBackup, replicationPolicies, storageHostById]);

  const openReplication = (backup: Backup) => {
    setReplicationBackup(backup);
    const defaultHostIds = replicationPolicies
      .filter((policy) => policy.enabled && policy.database_config === backup.database_config)
      .map((policy) => policy.storage_host);
    setSelectedReplicationHosts(new Set(defaultHostIds));
    setReplicationError(null);
    setReplicationOpen(true);
  };

  const toggleReplicationHost = (hostId: number) => {
    setSelectedReplicationHosts((prev) => {
      const next = new Set(prev);
      if (next.has(hostId)) {
        next.delete(hostId);
      } else {
        next.add(hostId);
      }
      return next;
    });
  };

  const submitReplication = async () => {
    if (!accessToken || !replicationBackup) return;
    setReplicationError(null);
    const selectedIds = Array.from(selectedReplicationHosts);
    if (selectedIds.length === 0) {
      setReplicationError("Select at least one replication host.");
      return;
    }

    setReplicating(true);
    try {
      await replicateBackup(accessToken, replicationBackup.id, selectedIds);
      setReplicationOpen(false);
      await loadData();
      setTriggerMessage(`Manual replication accepted for backup #${replicationBackup.id}.`);
    } catch (err) {
      setReplicationError(err instanceof Error ? err.message : "Replication request failed.");
    } finally {
      setReplicating(false);
    }
  };

  // ── delete ─────────────────────────────────────────────────────────────────
  const openDeleteSingle = (backup: Backup) => {
    setCheckedIds(new Set([backup.id]));
    setDeleteTarget("single");
    setDeletePhrase("");
    setDeleteReplications(false);
    setDeleteError(null);
    setDeleteOpen(true);
  };

  const openDeleteBulk = () => {
    setDeleteTarget("bulk");
    setDeletePhrase("");
    setDeleteReplications(false);
    setDeleteError(null);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!accessToken) return;
    if (deletePhrase.trim().toLowerCase() !== "delete") {
      setDeleteError("Type delete to confirm.");
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await Promise.all(
        [...checkedIds].map((id) =>
          deleteBackup(accessToken, id, {
            confirmation_phrase: deletePhrase,
            delete_replications: deleteReplications,
          }),
        ),
      );
      setCheckedIds(new Set());
      setDeleteOpen(false);
      if (user?.role !== "ADMIN") {
        setTriggerMessage("Deletion request submitted to admin.");
      }
      await loadData();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "One or more deletions failed.");
    } finally {
      setDeleting(false);
    }
  };

  const reviewDeletionRequest = async (requestId: number, action: "APPROVED" | "DENIED") => {
    if (!accessToken) return;
    setReviewingRequestId(requestId);
    try {
      await reviewBackupDeletionRequest(accessToken, requestId, { action });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review deletion request.");
    } finally {
      setReviewingRequestId(null);
    }
  };

  // ── select helpers ─────────────────────────────────────────────────────────
  const allChecked = rows.length > 0 && rows.every((r) => checkedIds.has(r.id));
  const someChecked = !allChecked && rows.some((r) => checkedIds.has(r.id));

  const toggleAll = () => {
    if (allChecked) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(rows.map((r) => r.id)));
    }
  };

  const toggleRow = (id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── trigger ────────────────────────────────────────────────────────────────
  const handleManualTrigger = async () => {
    if (!accessToken || !selectedConfigId) return;
    setTriggering(true);
    setTriggerMessage(null);
    try {
      const result = await triggerBackup(accessToken, selectedConfigId);
      setTriggerMessage(`Backup accepted for ${result.database}.`);
      await loadData();
    } catch (err) {
      setTriggerMessage(err instanceof Error ? err.message : "Failed to trigger backup.");
    } finally {
      setTriggering(false);
    }
  };

  const selectedDb = selectedBackup
    ? dbById.get(configById.get(selectedBackup.database_config)?.database ?? -1)
    : null;

  const selectedConfig = useMemo(() => configs.find((cfg) => cfg.id === selectedConfigId), [configs, selectedConfigId]);
  const selectedConfigDatabase = selectedConfig ? dbById.get(selectedConfig.database) : undefined;
  const selectedPolicies = useMemo(
    () => replicationPolicies.filter((policy) => policy.database_config === selectedConfigId && policy.enabled),
    [replicationPolicies, selectedConfigId],
  );

  const upcomingBackupAt = useMemo(() => findNextBackupOccurrence(selectedConfig, new Date()), [selectedConfig]);

  const nextReplicationItems = useMemo(
    () =>
      selectedPolicies.map((policy) => {
        const nextAt = findNextReplicationOccurrence(policy, new Date(), upcomingBackupAt);
        const hostName = storageHostById.get(policy.storage_host)?.name ?? `Host ${policy.storage_host}`;
        return { id: policy.id, hostName, frequencyMinutes: policy.replication_frequency_minutes, nextAt };
      }),
    [selectedPolicies, storageHostById, upcomingBackupAt],
  );

  const deleteCount = checkedIds.size;

  return (
    <Section label="backups" title="Backups & Restore">
      {/* ── manual trigger ── */}
      <div className="mb-4 rounded-2xl border border-border bg-muted/30 p-4">
        <p className="mb-3 text-sm font-medium text-foreground">Manual Backup Trigger</p>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <select
            className="h-9 w-full rounded-xl border border-border bg-white px-3 text-sm shadow-soft md:max-w-xl"
            value={selectedConfigId || ""}
            onChange={(e) => setSelectedConfigId(Number(e.target.value))}
            disabled={configs.length === 0}
          >
            {configs.map((cfg) => {
              const db = dbById.get(cfg.database);
              const dbLabel = db ? `${db.name} (${db.db_type})` : `Database ${cfg.database}`;
              return (
                <option key={cfg.id} value={cfg.id}>
                  {dbLabel} · every {cfg.backup_frequency_minutes} min
                </option>
              );
            })}
          </select>
          <Button
            size="sm"
            onClick={() => void handleManualTrigger()}
            disabled={configs.length === 0 || !selectedConfigId || triggering}
          >
            {triggering ? "Triggering…" : "Trigger Backup"}
          </Button>
        </div>
        {configs.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Create a backup config first.</p>}
        {triggerMessage && <p className="mt-2 text-sm text-muted-foreground">{triggerMessage}</p>}
      </div>

      {selectedConfig && (
        <div className="mb-4 rounded-2xl border border-border bg-white p-4 shadow-soft">
          <p className="text-sm font-medium text-foreground">Upcoming Schedule</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {selectedConfigDatabase
              ? `${selectedConfigDatabase.name} (${selectedConfigDatabase.db_type})`
              : `Config ${selectedConfig.id}`}
          </p>
          {!selectedConfig.enabled ? (
            <p className="mt-3 text-sm text-muted-foreground">Backup scheduling is disabled for this database config.</p>
          ) : (
            <>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Next Backup</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{formatScheduleTimestamp(upcomingBackupAt)}</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Replication Targets</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{nextReplicationItems.length}</p>
                </div>
              </div>
              {nextReplicationItems.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {nextReplicationItems.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 px-3 py-2">
                      <p className="text-xs text-foreground">{item.hostName}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.frequencyMinutes == null ? "After next successful backup" : `Every ${item.frequencyMinutes} min`} · {formatScheduleTimestamp(item.nextAt)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">No enabled replication policies for this config.</p>
              )}
            </>
          )}
        </div>
      )}

      {user?.role === "ADMIN" && (
        <div className="mb-4 rounded-2xl border border-border bg-white p-4 shadow-soft">
          <p className="text-sm font-medium text-foreground">Deletion Requests</p>
          {deletionRequests.filter((request) => request.status === "PENDING").length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No pending deletion requests.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {deletionRequests
                .filter((request) => request.status === "PENDING")
                .map((request) => (
                  <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                    <p className="text-xs text-foreground">
                      Request #{request.id} · Backup #{request.backup} · Delete replications: {request.delete_replications ? "Yes" : "No"}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={reviewingRequestId === request.id}
                        onClick={() => void reviewDeletionRequest(request.id, "DENIED")}
                      >
                        Deny
                      </Button>
                      <Button
                        size="sm"
                        disabled={reviewingRequestId === request.id}
                        onClick={() => void reviewDeletionRequest(request.id, "APPROVED")}
                      >
                        Approve
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {loading && <p className="mb-4 text-sm text-muted-foreground">Loading backups...</p>}
      {error && <p className="mb-4 text-sm text-failure">{error}</p>}

      {/* ── bulk-delete bar ── */}
      {checkedIds.size > 0 && (
        <div className="mb-3 flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{checkedIds.size} selected</span>
          <Button size="sm" variant="danger" onClick={openDeleteBulk}>
            Delete {checkedIds.size} backup{checkedIds.size !== 1 ? "s" : ""}
          </Button>
          <button
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setCheckedIds(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      <TableWrapper>
        <Table>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 cursor-pointer accent-accent"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Database</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Replication</th>
              <th className="px-4 py-3">Completed</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`border-b border-border/70 hover:bg-muted/60 ${
                  checkedIds.has(row.id) ? "bg-accent/5" : ""
                }`}
              >
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer accent-accent"
                    checked={checkedIds.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                  />
                </td>
                <td className="px-4 py-2 text-xs">{row.id}</td>
                <td className="px-4 py-2 text-xs">{dbNameForConfig(row.database_config)}</td>
                <td className="px-4 py-2 text-xs">{formatBytes(row.file_size)}</td>
                <td className="px-4 py-2"><StatusBadge status={row.status} /></td>
                <td className="px-4 py-2">
                  {row.replications.length === 0 ? (
                    <span className="text-xs text-muted-foreground">Local only</span>
                  ) : (
                    <div className="space-y-1">
                      {row.replications.map((rep) => (
                        <div key={rep.id} className="flex items-center gap-2 text-xs">
                          <StatusBadge status={rep.status} />
                          <span className="text-muted-foreground">
                            {storageHostById.get(rep.storage_host)?.name ?? `Host ${rep.storage_host}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {row.completed_at ? new Date(row.completed_at).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-1.5">
                    {row.status === "SUCCESS" && (
                      <Button size="sm" variant="secondary" onClick={() => openRestore(row)}>Restore</Button>
                    )}
                    {row.status === "SUCCESS" && (
                      <Button size="sm" variant="secondary" onClick={() => openReplication(row)}>Replicate</Button>
                    )}
                    <Button size="sm" variant="danger" onClick={() => openDeleteSingle(row)}>Delete</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrapper>

      {!loading && rows.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No backups found yet.</p>}

      {/* ── restore modal ── */}
      <Modal open={restoreOpen} onClose={() => setRestoreOpen(false)} title="Restore Backup">
        <p className="rounded-xl border border-failure/30 bg-failure/10 p-4 text-sm text-failure">
          This will restore the backup into the target database. The restore runs asynchronously.
        </p>

        {selectedDb && (
          <p className="mt-3 text-sm text-muted-foreground">
            Backup type: <strong>{selectedDb.db_type}</strong> — {selectedDb.db_type === "SQLITE"
              ? "enter the destination file path"
              : "enter the target database name (will be created if it doesn't exist)"}
          </p>
        )}

        <div className="mt-4 space-y-3">
          <Input
            placeholder={selectedDb?.db_type === "SQLITE" ? "/path/to/target.db" : "Target database name"}
            value={targetDb}
            onChange={(e) => setTargetDb(e.target.value)}
          />
          <Input
            placeholder="Type: CONFIRM RESTORE"
            value={confirmationPhrase}
            onChange={(e) => setConfirmationPhrase(e.target.value)}
          />
          {restoreError && <p className="text-sm text-failure">{restoreError}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setRestoreOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={submitRestore}>Confirm Restore</Button>
        </div>
      </Modal>

      {/* ── manual replication modal ── */}
      <Modal open={replicationOpen} onClose={() => !replicating && setReplicationOpen(false)} title="Manual Replication">
        <p className="text-sm text-muted-foreground">
          Select one or more configured replication hosts for backup #{replicationBackup?.id}.
        </p>

        {replicationHostOptions.length === 0 ? (
          <p className="mt-4 rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            No enabled replication hosts are configured for this backup's database config.
          </p>
        ) : (
          <div className="mt-4 max-h-72 space-y-2 overflow-y-auto rounded-xl border border-border p-3">
            {replicationHostOptions.map((option) => (
              <label key={option.storageHostId} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-accent"
                  checked={selectedReplicationHosts.has(option.storageHostId)}
                  onChange={() => toggleReplicationHost(option.storageHostId)}
                />
                <span className="flex flex-col">
                  <span className="text-sm text-foreground">{option.hostName}</span>
                  <span className="text-xs text-muted-foreground">Remote path: {option.remotePath}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        {replicationError && <p className="mt-3 text-sm text-failure">{replicationError}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setReplicationOpen(false)} disabled={replicating}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => void submitReplication()}
            disabled={replicating || replicationHostOptions.length === 0}
          >
            {replicating ? "Scheduling…" : "Start Replication"}
          </Button>
        </div>
      </Modal>

      {/* ── delete confirmation modal ── */}
      <Modal open={deleteOpen} onClose={() => !deleting && setDeleteOpen(false)} title="Delete Backup">
        <p className="rounded-xl border border-failure/30 bg-failure/10 p-4 text-sm text-failure">
          {user?.role === "ADMIN"
            ? deleteTarget === "bulk"
              ? `Permanently delete ${deleteCount} backup file${deleteCount !== 1 ? "s" : ""}? This cannot be undone.`
              : "Permanently delete this backup file? This cannot be undone."
            : deleteTarget === "bulk"
              ? `Submit ${deleteCount} deletion request${deleteCount !== 1 ? "s" : ""} to admin?`
              : "Submit a deletion request to admin for this backup?"}
        </p>

        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-accent"
              checked={deleteReplications}
              onChange={(e) => setDeleteReplications(e.target.checked)}
            />
            Delete replication artifacts as well
          </label>
          <Input placeholder="Type delete to confirm" value={deletePhrase} onChange={(e) => setDeletePhrase(e.target.value)} />
          {deleteError && <p className="text-sm text-failure">{deleteError}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
          <Button size="sm" variant="danger" onClick={() => void confirmDelete()} disabled={deleting}>
            {deleting
              ? user?.role === "ADMIN"
                ? "Deleting…"
                : "Submitting…"
              : user?.role === "ADMIN"
                ? `Delete${deleteCount > 1 ? ` ${deleteCount}` : ""}`
                : `Request Delete${deleteCount > 1 ? ` ${deleteCount}` : ""}`}
          </Button>
        </div>
      </Modal>
    </Section>
  );
}
