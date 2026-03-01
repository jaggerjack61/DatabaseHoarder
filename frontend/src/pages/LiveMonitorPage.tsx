import { useEffect, useMemo, useState } from "react";
import { HardDrive, Plug, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";
import { Table, TableWrapper } from "@/components/ui/Table";
import { useAuth } from "@/context/AuthContext";
import { getConfigs, getConnectionStatus, getDatabases, getLiveBackups, getLiveRestorations, getStorageHosts } from "@/lib/api";
import { Backup, ConnectionStatusResponse, Database, DatabaseConfig, LiveBackupsResponse, LiveRestorationsResponse, RestoreJob, StorageHost } from "@/types/api";

function StatusBadge({ status }: { status: Backup["status"] | "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" }) {
  if (status === "SUCCESS") return <Badge variant="success">Success</Badge>;
  if (status === "FAILED") return <Badge variant="failed">Failed</Badge>;
  if (status === "RUNNING") return (
    <Badge variant="running">
      <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />Running
    </Badge>
  );
  return <Badge variant="neutral">Pending</Badge>;
}

function ConnectionBadge({ success }: { success: boolean }) {
  if (success) return <Badge variant="success">Online</Badge>;
  return <Badge variant="failed">Failed</Badge>;
}

const tabs = [
  { id: "backups", label: "Backups", icon: HardDrive },
  { id: "restorations", label: "Restorations", icon: RotateCcw },
  { id: "connections", label: "Connections", icon: Plug },
] as const;

export function LiveMonitorPage() {
  const { accessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("backups");
  const [live, setLive] = useState<LiveBackupsResponse | null>(null);
  const [liveRestorations, setLiveRestorations] = useState<LiveRestorationsResponse | null>(null);
  const [configs, setConfigs] = useState<DatabaseConfig[]>([]);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [storageHosts, setStorageHosts] = useState<StorageHost[]>([]);
  const [connections, setConnections] = useState<ConnectionStatusResponse | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [connectionsAutoRefresh, setConnectionsAutoRefresh] = useState(true);
  const [connectionInterval, setConnectionInterval] = useState(300);

  const dbById = useMemo(() => new Map(databases.map((d) => [d.id, d])), [databases]);
  const configById = useMemo(() => new Map(configs.map((c) => [c.id, c])), [configs]);
  const storageHostById = useMemo(() => new Map(storageHosts.map((h) => [h.id, h])), [storageHosts]);

  const dbNameForConfig = (configId: number) => {
    const cfg = configById.get(configId);
    if (!cfg) return `Config ${configId}`;
    const db = dbById.get(cfg.database);
    const displayName = db ? db.alias || db.name : `Database ${cfg.database}`;
    return db ? `${displayName} (${db.db_type})` : displayName;
  };

  const loadLookups = async () => {
    if (!accessToken) return;
    const [cfgs, dbs, shs] = await Promise.all([
      getConfigs(accessToken),
      getDatabases(accessToken),
      getStorageHosts(accessToken),
    ]);
    setConfigs(cfgs);
    setDatabases(dbs);
    setStorageHosts(shs);
  };

  const loadLive = async () => {
    if (!accessToken) return;
    try {
      const [response, restoreResponse] = await Promise.all([
        getLiveBackups(accessToken),
        getLiveRestorations(accessToken),
      ]);
      setLive(response);
      setLiveRestorations(restoreResponse);
      setError(null);
    } catch {
      setError("Unable to load live backup data.");
    } finally {
      setLoading(false);
    }
  };

  const loadConnections = async (force = false) => {
    if (!accessToken) return;
    setConnectionsLoading(true);
    try {
      const response = await getConnectionStatus(accessToken, { force });
      setConnections(response);
      setConnectionInterval(response.poll_interval_seconds || 300);
      setConnectionsError(null);
    } catch {
      setConnectionsError("Unable to load connection status.");
    } finally {
      setConnectionsLoading(false);
    }
  };

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    void Promise.all([loadLookups(), loadLive(), loadConnections(false)]);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !autoRefresh) return;
    const timer = window.setInterval(() => {
      void loadLive();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [accessToken, autoRefresh]);

  useEffect(() => {
    if (!accessToken || !connectionsAutoRefresh) return;
    const intervalMs = Math.max(15, connectionInterval) * 1000;
    const timer = window.setInterval(() => {
      void loadConnections(false);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [accessToken, connectionsAutoRefresh, connectionInterval]);

  const rows = live?.items ?? [];
  const connectionRows = useMemo(() => {
    if (!connections) return [];
    const hostRows = connections.storage_hosts.map((host) => ({
      id: `sh-${host.id}`,
      type: "Storage Host",
      name: host.name,
      target: `${host.address}:${host.ssh_port}`,
      success: host.success,
      message: host.message,
    }));
    const dbRows = connections.databases.map((db) => {
      const name = db.alias || db.name;
      const target = db.db_type === "SQLITE"
        ? db.sqlite_location === "REMOTE"
          ? `${db.host}:${db.port} · ${db.sqlite_path}`
          : db.sqlite_path || db.host
        : `${db.host}:${db.port}`;
      return {
        id: `db-${db.id}`,
        type: `Database · ${db.db_type}`,
        name,
        target,
        success: db.success,
        message: db.message,
      };
    });
    return [...hostRows, ...dbRows];
  }, [connections]);

  return (
    <Section label="monitor" title="Live Backup Monitor">
      <div className="mb-6 flex gap-2 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 border-b-2 px-4 pb-3 pt-1 text-sm font-medium transition ${
              activeTab === tab.id
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-muted/30 p-4">
        {activeTab === "connections" ? (
          <>
            <Button variant="secondary" onClick={() => void loadConnections(true)} disabled={connectionsLoading}>
              {connectionsLoading ? "Checking…" : "Check Now"}
            </Button>
            <Button variant={connectionsAutoRefresh ? "primary" : "secondary"} onClick={() => setConnectionsAutoRefresh((v) => !v)}>
              {connectionsAutoRefresh ? "Auto-check: On" : "Auto-check: Off"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Polling every {connectionInterval} seconds while enabled.
            </p>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => void loadLive()}>Refresh Now</Button>
            <Button variant={autoRefresh ? "primary" : "secondary"} onClick={() => setAutoRefresh((v) => !v)}>
              {autoRefresh ? "Auto-refresh: On" : "Auto-refresh: Off"}
            </Button>
            <p className="text-xs text-muted-foreground">Polling every 3 seconds while enabled.</p>
          </>
        )}
      </div>

      {activeTab !== "connections" && live && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-2xl border border-border bg-white p-3">
            <p className="text-xs text-muted-foreground">Running Backups</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{live.summary.running_backups}</p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-3">
            <p className="text-xs text-muted-foreground">Pending Backups</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{live.summary.pending_backups}</p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-3">
            <p className="text-xs text-muted-foreground">Running Replications</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{live.summary.running_replications}</p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-3">
            <p className="text-xs text-muted-foreground">Pending Replications</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{live.summary.pending_replications}</p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-3">
            <p className="text-xs text-muted-foreground">Failed Replications</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{live.summary.failed_replications}</p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-3">
            <p className="text-xs text-muted-foreground">Tracked Items</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{live.summary.total_items}</p>
          </div>
        </div>
      )}

      {activeTab !== "connections" && liveRestorations && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-border bg-white p-3">
            <p className="text-xs text-muted-foreground">Running Restorations</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{liveRestorations.summary.running_restorations}</p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-3">
            <p className="text-xs text-muted-foreground">Pending Restorations</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{liveRestorations.summary.pending_restorations}</p>
          </div>
          <div className="rounded-2xl border border-border bg-white p-3">
            <p className="text-xs text-muted-foreground">Restoration Items</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{liveRestorations.summary.total_items}</p>
          </div>
        </div>
      )}

      {activeTab === "backups" && (
        <>
          {loading && <p className="mb-4 text-sm text-muted-foreground">Loading live backup data...</p>}
          {error && <p className="mb-4 text-sm text-failure">{error}</p>}

          <TableWrapper>
            <Table>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Backup</th>
                  <th className="px-4 py-3">Database</th>
                  <th className="px-4 py-3">Backup Status</th>
                  <th className="px-4 py-3">Replications</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Completed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/70 hover:bg-muted/60">
                    <td className="px-4 py-3">#{row.id}</td>
                    <td className="px-4 py-3">{dbNameForConfig(row.database_config)}</td>
                    <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {row.started_at ? new Date(row.started_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {row.completed_at ? new Date(row.completed_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrapper>

          {!loading && rows.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No active or recent backups yet.</p>}
        </>
      )}

      {activeTab === "restorations" && (
        <>
          {loading && <p className="mb-4 text-sm text-muted-foreground">Loading restorations...</p>}
          {error && <p className="mb-4 text-sm text-failure">{error}</p>}

          <TableWrapper>
            <Table>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Restore #</th>
                  <th className="px-4 py-3">Backup #</th>
                  <th className="px-4 py-3">Source Config</th>
                  <th className="px-4 py-3">Source DB</th>
                  <th className="px-4 py-3">Target DB</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Triggered By</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Completed</th>
                </tr>
              </thead>
              <tbody>
                {(liveRestorations?.items ?? []).map((job: RestoreJob) => (
                  <tr key={job.id} className="border-b border-border/70 hover:bg-muted/60">
                    <td className="px-4 py-3">#{job.id}</td>
                    <td className="px-4 py-3">#{job.backup}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">#{job.backup_database_config}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {job.backup_database_name || job.backup_database_fallback_name || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{job.target_db}</td>
                    <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{job.triggered_by ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {job.started_at ? new Date(job.started_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {job.completed_at ? new Date(job.completed_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrapper>

          {!loading && (liveRestorations?.items ?? []).length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">No active or recent restorations.</p>
          )}
        </>
      )}

      {activeTab === "connections" && (
        <>
          {connectionsError && <p className="mb-4 text-sm text-failure">{connectionsError}</p>}
          <div className="mb-2 text-xs text-muted-foreground">
            {connections?.checked_at ? `Last checked: ${new Date(connections.checked_at).toLocaleString()}` : "No checks yet."}
          </div>

          <TableWrapper>
            <Table>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Message</th>
                </tr>
              </thead>
              <tbody>
                {connectionRows.map((row) => (
                  <tr key={row.id} className="border-b border-border/70 hover:bg-muted/60">
                    <td className="px-4 py-3 text-xs text-muted-foreground">{row.type}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{row.name}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{row.target}</td>
                    <td className="px-4 py-3"><ConnectionBadge success={row.success} /></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{row.message || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrapper>

          {!connectionsLoading && connectionRows.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">No connections to check yet.</p>
          )}
        </>
      )}
    </Section>
  );
}
