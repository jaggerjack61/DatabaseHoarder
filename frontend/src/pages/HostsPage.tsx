import { FormEvent, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Plus,
  Server,
  Database as DatabaseIcon,
  Settings2,
  GitFork,
  Pencil,
  TestTube2,
  Trash2,
  LayoutGrid,
  List,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Section } from "@/components/ui/Section";
import { useAuth } from "@/context/AuthContext";
import {
  createConfig,
  createDatabase,
  createReplicationPolicy,
  createStorageHost,
  deleteConfig,
  deleteDatabase,
  deleteReplicationPolicy,
  deleteStorageHost,
  getConfigs,
  getDatabases,
  getReplicationPolicies,
  getStorageHosts,
  testDatabaseConnection,
  testDatabaseConnectionByPayload,
  testStorageHostConnection,
  testStorageHostConnectionByPayload,
  updateDatabase,
  updateStorageHost,
} from "@/lib/api";
import { defaultTransition, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { DatabaseType, DatabaseConfig, Database, StorageHost, ReplicationPolicy, SqliteLocation } from "@/types/api";

type TabId = "storage-hosts" | "databases" | "configs" | "replication";

const tabs: { id: TabId; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: "storage-hosts", label: "Storage Hosts", icon: Server },
  { id: "databases", label: "Databases", icon: DatabaseIcon },
  { id: "configs", label: "Backup Configs", icon: Settings2 },
  { id: "replication", label: "Replication Policies", icon: GitFork },
];

const DAYS_OF_WEEK = [
  { value: 0, short: "Mon", label: "Monday" },
  { value: 1, short: "Tue", label: "Tuesday" },
  { value: 2, short: "Wed", label: "Wednesday" },
  { value: 3, short: "Thu", label: "Thursday" },
  { value: 4, short: "Fri", label: "Friday" },
  { value: 5, short: "Sat", label: "Saturday" },
  { value: 6, short: "Sun", label: "Sunday" },
];

type FreqUnit = "minutes" | "hours" | "days";

function freqToMinutes(value: number, unit: FreqUnit): number {
  if (unit === "hours") return value * 60;
  if (unit === "days") return value * 1440;
  return value;
}

function minutesToDisplay(minutes: number): string {
  if (minutes === 0) return "Interval disabled";
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes / 1440 !== 1 ? "s" : ""}`;
  if (minutes % 60 === 0) return `${minutes / 60} hr${minutes / 60 !== 1 ? "s" : ""}`;
  return `${minutes} min`;
}

const ACTION_BTN = "h-9 min-h-0 px-3 text-xs";

export function HostsPage() {
  const { accessToken } = useAuth();
  const reduceMotion = useReducedMotion();

  const [activeTab, setActiveTab] = useState<TabId>("storage-hosts");
  const [viewMode, setViewMode] = useState<"card" | "list">("list");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [storageHosts, setStorageHosts] = useState<StorageHost[]>([]);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [configs, setConfigs] = useState<DatabaseConfig[]>([]);
  const [policies, setPolicies] = useState<ReplicationPolicy[]>([]);

  // Modal state
  const [openStorageHost, setOpenStorageHost] = useState(false);
  const [openDatabase, setOpenDatabase] = useState(false);
  const [openConfig, setOpenConfig] = useState(false);
  const [openPolicy, setOpenPolicy] = useState(false);

  // Edit state
  const [editingStorageHost, setEditingStorageHost] = useState<StorageHost | null>(null);
  const [editingDatabase, setEditingDatabase] = useState<Database | null>(null);
  const [editStorageHostForm, setEditStorageHostForm] = useState({ name: "", address: "", ssh_port: 22, username: "", password: "" });
  const [editDatabaseForm, setEditDatabaseForm] = useState({
    name: "",
    alias: "",
    db_type: "POSTGRES" as DatabaseType,
    host: "",
    port: 5432,
    username: "",
    password: "",
    sqlite_location: "LOCAL" as SqliteLocation,
    sqlite_path: "",
  });

  // Test connection state
  const [testingHostId, setTestingHostId] = useState<number | null>(null);
  const [testingDbId, setTestingDbId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [testingStorageHostCreate, setTestingStorageHostCreate] = useState(false);
  const [testingStorageHostEdit, setTestingStorageHostEdit] = useState(false);
  const [testingDatabaseCreate, setTestingDatabaseCreate] = useState(false);
  const [testingDatabaseEdit, setTestingDatabaseEdit] = useState(false);
  const [storageHostCreateTestResult, setStorageHostCreateTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [storageHostEditTestResult, setStorageHostEditTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [databaseCreateTestResult, setDatabaseCreateTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [databaseEditTestResult, setDatabaseEditTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Forms
  const [storageHostForm, setStorageHostForm] = useState({ name: "", address: "", ssh_port: 22, username: "", password: "" });
  const [databaseForm, setDatabaseForm] = useState({
    name: "",
    alias: "",
    db_type: "POSTGRES" as DatabaseType,
    host: "",
    port: 5432,
    username: "",
    password: "",
    sqlite_location: "LOCAL" as SqliteLocation,
    sqlite_path: "",
  });

  // Config form — includes flexible frequency helpers and new scheduling/retention fields
  const [configForm, setConfigForm] = useState({
    database: 0,
    frequencyValue: 1,
    frequencyUnit: "hours" as FreqUnit,
    retention_days: 7,
    backup_days_of_week: [] as number[],
    retention_keep_monthly_first: false,
    retention_keep_weekly_day: null as number | null,
    retention_exception_days: null as number | null,
    retention_exception_max_days: null as number | null,
  });

  // Policy form — includes independent schedule / separate retention helpers
  const [policyForm, setPolicyForm] = useState({
    database_config: 0,
    storage_host: 0,
    remote_path: "/backups",
    hasIndependentSchedule: false,
    replicationFreqValue: 1,
    replicationFreqUnit: "days" as FreqUnit,
    replication_days_of_week: [] as number[],
    replication_retention_days: null as number | null,
    replication_retention_exception_days: null as number | null,
    replication_retention_exception_max_days: null as number | null,
  });

  // Lookup maps
  const dbById = useMemo(() => new Map(databases.map((d) => [d.id, d])), [databases]);
  const configById = useMemo(() => new Map(configs.map((c) => [c.id, c])), [configs]);
  const storageHostById = useMemo(() => new Map(storageHosts.map((h) => [h.id, h])), [storageHosts]);

  const loadData = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [sh, db, cf, rp] = await Promise.all([
        getStorageHosts(accessToken),
        getDatabases(accessToken),
        getConfigs(accessToken),
        getReplicationPolicies(accessToken),
      ]);
      setStorageHosts(sh);
      setDatabases(db);
      setConfigs(cf);
      setPolicies(rp);
      if (db.length > 0 && configForm.database === 0) setConfigForm((p) => ({ ...p, database: db[0].id }));
      if (cf.length > 0 && policyForm.database_config === 0) setPolicyForm((p) => ({ ...p, database_config: cf[0].id }));
      if (sh.length > 0 && policyForm.storage_host === 0) setPolicyForm((p) => ({ ...p, storage_host: sh[0].id }));
    } catch {
      setError("Unable to load data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, [accessToken]);

  // --- Submit handlers ---
  const submitStorageHost = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    try {
      await createStorageHost(accessToken, { ...storageHostForm, is_active: true });
      setStorageHostForm({ name: "", address: "", ssh_port: 22, username: "", password: "" });
      setOpenStorageHost(false);
      await loadData();
    } catch { setError("Failed to create storage host."); }
  };

  const submitDatabase = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    try {
      const hostValue = databaseForm.db_type === "SQLITE" && databaseForm.sqlite_location === "LOCAL"
        ? databaseForm.sqlite_path
        : databaseForm.host;
      const aliasValue = databaseForm.db_type === "SQLITE"
        ? databaseForm.name
        : databaseForm.alias;
      await createDatabase(accessToken, { ...databaseForm, alias: aliasValue, host: hostValue, is_active: true });
      setDatabaseForm({
        name: "",
        alias: "",
        db_type: "POSTGRES",
        host: "",
        port: 5432,
        username: "",
        password: "",
        sqlite_location: "LOCAL",
        sqlite_path: "",
      });
      setOpenDatabase(false);
      await loadData();
    } catch { setError("Failed to create database."); }
  };

  const submitConfig = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken || !configForm.database) return;
    try {
      const frequencyMinutes = freqToMinutes(configForm.frequencyValue, configForm.frequencyUnit);
      if (frequencyMinutes === 0 && configForm.backup_days_of_week.length === 0) {
        setError("Select at least one weekday or set a backup interval greater than 0.");
        return;
      }
      await createConfig(accessToken, {
        database: configForm.database,
        backup_frequency_minutes: frequencyMinutes,
        retention_days: configForm.retention_days,
        backup_days_of_week: configForm.backup_days_of_week,
        retention_keep_monthly_first: configForm.retention_keep_monthly_first,
        retention_keep_weekly_day: configForm.retention_keep_weekly_day,
        retention_exception_days: configForm.retention_exception_days,
        retention_exception_max_days: configForm.retention_exception_max_days,
        enabled: true,
      });
      setOpenConfig(false);
      await loadData();
    } catch { setError("Failed to create backup config."); }
  };

  const openEditStorageHost = (host: StorageHost) => {
    setEditStorageHostForm({ name: host.name, address: host.address, ssh_port: host.ssh_port, username: host.username, password: "" });
    setStorageHostEditTestResult(null);
    setEditingStorageHost(host);
  };

  const submitEditStorageHost = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken || !editingStorageHost) return;
    try {
      await updateStorageHost(accessToken, editingStorageHost.id, editStorageHostForm);
      setEditingStorageHost(null);
      await loadData();
    } catch { setError("Failed to update storage host."); }
  };

  const openEditDatabase = (db: Database) => {
    setEditDatabaseForm({
      name: db.name,
      alias: db.alias || db.name,
      db_type: db.db_type,
      host: db.host,
      port: db.port,
      username: db.username,
      password: "",
      sqlite_location: db.sqlite_location ?? "LOCAL",
      sqlite_path: db.sqlite_path ?? "",
    });
    setDatabaseEditTestResult(null);
    setEditingDatabase(db);
  };

  const submitEditDatabase = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken || !editingDatabase) return;
    try {
      const hostValue = editDatabaseForm.db_type === "SQLITE" && editDatabaseForm.sqlite_location === "LOCAL"
        ? editDatabaseForm.sqlite_path
        : editDatabaseForm.host;
      const aliasValue = editDatabaseForm.db_type === "SQLITE"
        ? editDatabaseForm.name
        : editDatabaseForm.alias;
      await updateDatabase(accessToken, editingDatabase.id, { ...editDatabaseForm, alias: aliasValue, host: hostValue });
      setEditingDatabase(null);
      await loadData();
    } catch { setError("Failed to update database."); }
  };

  const handleTestStorageHost = async (id: number) => {
    if (!accessToken) return;
    setTestingHostId(id);
    try {
      const result = await testStorageHostConnection(accessToken, id);
      setTestResults((prev) => ({ ...prev, [`sh-${id}`]: result }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [`sh-${id}`]: { success: false, message: String(err) } }));
    } finally { setTestingHostId(null); }
  };

  const handleTestDatabase = async (id: number) => {
    if (!accessToken) return;
    setTestingDbId(id);
    try {
      const result = await testDatabaseConnection(accessToken, id);
      setTestResults((prev) => ({ ...prev, [`db-${id}`]: result }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [`db-${id}`]: { success: false, message: String(err) } }));
    } finally { setTestingDbId(null); }
  };

  const handleTestCreateStorageHostForm = async () => {
    if (!accessToken || !storageHostForm.address || !storageHostForm.username) return;
    setTestingStorageHostCreate(true);
    try {
      const result = await testStorageHostConnectionByPayload(accessToken, {
        address: storageHostForm.address,
        ssh_port: storageHostForm.ssh_port,
        username: storageHostForm.username,
        password: storageHostForm.password,
      });
      setStorageHostCreateTestResult(result);
    } catch (err) {
      setStorageHostCreateTestResult({ success: false, message: String(err) });
    } finally {
      setTestingStorageHostCreate(false);
    }
  };

  const handleTestEditStorageHostForm = async () => {
    if (!accessToken || !editStorageHostForm.address || !editStorageHostForm.username) return;
    setTestingStorageHostEdit(true);
    try {
      const result = await testStorageHostConnectionByPayload(accessToken, {
        address: editStorageHostForm.address,
        ssh_port: editStorageHostForm.ssh_port,
        username: editStorageHostForm.username,
        password: editStorageHostForm.password,
      });
      setStorageHostEditTestResult(result);
    } catch (err) {
      setStorageHostEditTestResult({ success: false, message: String(err) });
    } finally {
      setTestingStorageHostEdit(false);
    }
  };

  const handleTestCreateDatabaseForm = async () => {
    const hostValue = databaseForm.db_type === "SQLITE" && databaseForm.sqlite_location === "LOCAL"
      ? databaseForm.sqlite_path
      : databaseForm.host;
    if (!accessToken || !hostValue) return;
    setTestingDatabaseCreate(true);
    try {
      const result = await testDatabaseConnectionByPayload(accessToken, {
        db_type: databaseForm.db_type,
        host: hostValue,
        port: databaseForm.port,
        username: databaseForm.username,
        password: databaseForm.password,
        sqlite_location: databaseForm.sqlite_location,
        sqlite_path: databaseForm.sqlite_path,
      });
      setDatabaseCreateTestResult(result);
    } catch (err) {
      setDatabaseCreateTestResult({ success: false, message: String(err) });
    } finally {
      setTestingDatabaseCreate(false);
    }
  };

  const handleTestEditDatabaseForm = async () => {
    const hostValue = editDatabaseForm.db_type === "SQLITE" && editDatabaseForm.sqlite_location === "LOCAL"
      ? editDatabaseForm.sqlite_path
      : editDatabaseForm.host;
    if (!accessToken || !hostValue) return;
    setTestingDatabaseEdit(true);
    try {
      const result = await testDatabaseConnectionByPayload(accessToken, {
        db_type: editDatabaseForm.db_type,
        host: hostValue,
        port: editDatabaseForm.port,
        username: editDatabaseForm.username,
        password: editDatabaseForm.password,
        sqlite_location: editDatabaseForm.sqlite_location,
        sqlite_path: editDatabaseForm.sqlite_path,
      });
      setDatabaseEditTestResult(result);
    } catch (err) {
      setDatabaseEditTestResult({ success: false, message: String(err) });
    } finally {
      setTestingDatabaseEdit(false);
    }
  };

  const submitPolicy = async (e: FormEvent) => {
    e.preventDefault();
    if (!accessToken || !policyForm.database_config || !policyForm.storage_host) return;
    try {
      await createReplicationPolicy(accessToken, {
        database_config: policyForm.database_config,
        storage_host: policyForm.storage_host,
        remote_path: policyForm.remote_path,
        enabled: true,
        replication_frequency_minutes: policyForm.hasIndependentSchedule
          ? freqToMinutes(policyForm.replicationFreqValue, policyForm.replicationFreqUnit)
          : null,
        replication_days_of_week: policyForm.hasIndependentSchedule ? policyForm.replication_days_of_week : [],
        replication_retention_days: policyForm.replication_retention_days,
        replication_retention_exception_days: policyForm.replication_retention_exception_days,
        replication_retention_exception_max_days: policyForm.replication_retention_exception_max_days,
      });
      setOpenPolicy(false);
      await loadData();
    } catch { setError("Failed to create replication policy."); }
  };

  const dbTypeLabel: Record<DatabaseType, string> = { POSTGRES: "PostgreSQL", MYSQL: "MySQL", SQLITE: "SQLite" };
  const dbDisplayName = (db: Database) => db.alias || db.name;
  const sqliteDisplayPath = (db: Database) => db.sqlite_path || db.host;
  const sqliteHostLabel = (db: Database) =>
    db.sqlite_location === "REMOTE" ? `${db.host}:${db.port}` : `Local · ${sqliteDisplayPath(db)}`;

  // -------------------------------------------------------------------------
  // View toggle component
  // -------------------------------------------------------------------------
  const ViewToggle = () => (
    <div className="flex overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setViewMode("card")}
        className={cn(
          "px-3 py-2 transition",
          viewMode === "card" ? "bg-accent text-white" : "bg-white text-muted-foreground hover:bg-muted",
        )}
        title="Card view"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setViewMode("list")}
        className={cn(
          "border-l border-border px-3 py-2 transition",
          viewMode === "list" ? "bg-accent text-white" : "bg-white text-muted-foreground hover:bg-muted",
        )}
        title="List view"
      >
        <List className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <Section label="hosts" title="Hosts & Databases">
      {/* Tab bar */}
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

      {loading && <p className="mb-4 text-sm text-muted-foreground">Loading...</p>}
      {error && <p className="mb-4 text-sm text-failure">{error}</p>}

      {/* ------------------------------------------------------------------ */}
      {/* STORAGE HOSTS TAB                                                   */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === "storage-hosts" && (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">SSH servers used to store replicated backup files.</p>
            <div className="flex items-center gap-2">
              <ViewToggle />
              <Button onClick={() => setOpenStorageHost(true)}><Plus className="mr-2 h-4 w-4" />Add Storage Host</Button>
            </div>
          </div>

          {viewMode === "card" ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {storageHosts.map((host, i) => (
                <motion.div key={host.id} initial={fadeUp.initial} animate={fadeUp.animate}
                  transition={reduceMotion ? { duration: 0 } : { ...defaultTransition, delay: i * 0.07 }}>
                  <Card className="group relative overflow-hidden hover:-translate-y-1 hover:shadow-hover transition-transform duration-200">
                    <div className="bg-gradient-accent absolute inset-x-0 top-0 h-1 opacity-70" />
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground">{host.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{host.address}:{host.ssh_port}</p>
                        <p className="mt-1 text-sm text-muted-foreground">User: {host.username}</p>
                        {testResults[`sh-${host.id}`] && (
                          <p className={`mt-2 text-xs ${testResults[`sh-${host.id}`].success ? "text-success" : "text-failure"}`}>
                            {testResults[`sh-${host.id}`].success ? "✓" : "✗"} {testResults[`sh-${host.id}`].message}
                          </p>
                        )}
                      </div>
                      <div className="ml-2 flex shrink-0 flex-col items-end gap-1.5">
                        <Button type="button" variant="blue" className={ACTION_BTN} onClick={() => openEditStorageHost(host)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" />Edit
                        </Button>
                        <Button type="button" variant="success" className={ACTION_BTN}
                          onClick={() => void handleTestStorageHost(host.id)} disabled={testingHostId === host.id}>
                          <TestTube2 className="mr-1 h-3.5 w-3.5" />{testingHostId === host.id ? "Testing…" : "Test"}
                        </Button>
                        <Button type="button" variant="danger" className={ACTION_BTN}
                          onClick={() => void deleteStorageHost(accessToken!, host.id).then(loadData)}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" />Remove
                        </Button>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Address</th>
                    <th className="px-4 py-3 text-left">User</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {storageHosts.map((host) => (
                    <tr key={host.id} className="border-t border-border hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium text-foreground">{host.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{host.address}:{host.ssh_port}</td>
                      <td className="px-4 py-3 text-muted-foreground">{host.username}</td>
                      <td className="px-4 py-3">
                        {testResults[`sh-${host.id}`] && (
                          <span className={`text-xs ${testResults[`sh-${host.id}`].success ? "text-success" : "text-failure"}`}>
                            {testResults[`sh-${host.id}`].success ? "✓" : "✗"} {testResults[`sh-${host.id}`].message}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button type="button" variant="blue" className={ACTION_BTN} onClick={() => openEditStorageHost(host)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" />Edit
                          </Button>
                          <Button type="button" variant="success" className={ACTION_BTN}
                            onClick={() => void handleTestStorageHost(host.id)} disabled={testingHostId === host.id}>
                            <TestTube2 className="mr-1 h-3.5 w-3.5" />{testingHostId === host.id ? "Testing…" : "Test"}
                          </Button>
                          <Button type="button" variant="danger" className={ACTION_BTN}
                            onClick={() => void deleteStorageHost(accessToken!, host.id).then(loadData)}>
                            <Trash2 className="mr-1 h-3.5 w-3.5" />Remove
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && storageHosts.length === 0 && (
            <p className="text-sm text-muted-foreground">No storage hosts yet. Add your first SSH server.</p>
          )}

          <Modal open={openStorageHost} onClose={() => setOpenStorageHost(false)} title="Add Storage Host">
            <form className="space-y-3" onSubmit={submitStorageHost}>
              <p className="text-xs text-muted-foreground">SSH server that will receive replicated backup files.</p>
              <Input placeholder="Name (e.g. backup-server-1)" value={storageHostForm.name}
                onChange={(e) => setStorageHostForm((p) => ({ ...p, name: e.target.value }))} required />
              <Input placeholder="Address (IP or hostname)" value={storageHostForm.address}
                onChange={(e) => setStorageHostForm((p) => ({ ...p, address: e.target.value }))} required />
              <Input type="number" placeholder="SSH port" value={storageHostForm.ssh_port}
                onChange={(e) => setStorageHostForm((p) => ({ ...p, ssh_port: Number(e.target.value) }))} required />
              <Input placeholder="SSH username" value={storageHostForm.username}
                onChange={(e) => setStorageHostForm((p) => ({ ...p, username: e.target.value }))} required />
              <Input type="password" placeholder="SSH password" value={storageHostForm.password}
                onChange={(e) => setStorageHostForm((p) => ({ ...p, password: e.target.value }))} />
              {storageHostCreateTestResult && (
                <p className={`text-xs ${storageHostCreateTestResult.success ? "text-success" : "text-failure"}`}>
                  {storageHostCreateTestResult.success ? "✓" : "✗"} {storageHostCreateTestResult.message}
                </p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpenStorageHost(false)}>Cancel</Button>
                <Button variant="success" type="button" onClick={() => void handleTestCreateStorageHostForm()}
                  disabled={testingStorageHostCreate || !storageHostForm.address || !storageHostForm.username}>
                  {testingStorageHostCreate ? "Testing…" : "Test Connection"}
                </Button>
                <Button type="submit">Create</Button>
              </div>
            </form>
          </Modal>

          <Modal open={editingStorageHost !== null} onClose={() => setEditingStorageHost(null)} title="Edit Storage Host">
            <form className="space-y-3" onSubmit={submitEditStorageHost}>
              <Input placeholder="Name" value={editStorageHostForm.name}
                onChange={(e) => setEditStorageHostForm((p) => ({ ...p, name: e.target.value }))} required />
              <Input placeholder="Address (IP or hostname)" value={editStorageHostForm.address}
                onChange={(e) => setEditStorageHostForm((p) => ({ ...p, address: e.target.value }))} required />
              <Input type="number" placeholder="SSH port" value={editStorageHostForm.ssh_port}
                onChange={(e) => setEditStorageHostForm((p) => ({ ...p, ssh_port: Number(e.target.value) }))} required />
              <Input placeholder="SSH username" value={editStorageHostForm.username}
                onChange={(e) => setEditStorageHostForm((p) => ({ ...p, username: e.target.value }))} required />
              <Input type="password" placeholder="New SSH password (leave blank to keep existing)" value={editStorageHostForm.password}
                onChange={(e) => setEditStorageHostForm((p) => ({ ...p, password: e.target.value }))} />
              {storageHostEditTestResult && (
                <p className={`text-xs ${storageHostEditTestResult.success ? "text-success" : "text-failure"}`}>
                  {storageHostEditTestResult.success ? "✓" : "✗"} {storageHostEditTestResult.message}
                </p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" type="button" onClick={() => setEditingStorageHost(null)}>Cancel</Button>
                <Button variant="success" type="button" onClick={() => void handleTestEditStorageHostForm()}
                  disabled={testingStorageHostEdit || !editStorageHostForm.address || !editStorageHostForm.username}>
                  {testingStorageHostEdit ? "Testing…" : "Test Connection"}
                </Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          </Modal>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* DATABASES TAB                                                        */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === "databases" && (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Database connections that will be backed up.</p>
            <div className="flex items-center gap-2">
              <ViewToggle />
              <Button onClick={() => setOpenDatabase(true)}><Plus className="mr-2 h-4 w-4" />Add Database</Button>
            </div>
          </div>

          {viewMode === "card" ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {databases.map((db, i) => (
                <motion.div key={db.id} initial={fadeUp.initial} animate={fadeUp.animate}
                  transition={reduceMotion ? { duration: 0 } : { ...defaultTransition, delay: i * 0.07 }}>
                  <Card className="group relative overflow-hidden hover:-translate-y-1 hover:shadow-hover transition-transform duration-200">
                    <div className="bg-gradient-accent absolute inset-x-0 top-0 h-1 opacity-70" />
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground">{dbDisplayName(db)}</p>
                        {db.db_type === "SQLITE" ? (
                          <>
                            <p className="mt-1 text-sm text-muted-foreground">{dbTypeLabel[db.db_type]}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{sqliteHostLabel(db)}</p>
                            <p className="mt-1 text-sm text-muted-foreground">Path: {sqliteDisplayPath(db)}</p>
                            {db.sqlite_location === "REMOTE" && (
                              <p className="mt-1 text-sm text-muted-foreground">User: {db.username}</p>
                            )}
                          </>
                        ) : (
                          <>
                            <p className="mt-1 text-sm text-muted-foreground">{dbTypeLabel[db.db_type]}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{db.host}:{db.port} · {db.username}</p>
                          </>
                        )}
                        {testResults[`db-${db.id}`] && (
                          <p className={`mt-2 text-xs ${testResults[`db-${db.id}`].success ? "text-success" : "text-failure"}`}>
                            {testResults[`db-${db.id}`].success ? "✓" : "✗"} {testResults[`db-${db.id}`].message}
                          </p>
                        )}
                      </div>
                      <div className="ml-2 flex shrink-0 flex-col items-end gap-1.5">
                        <Button type="button" variant="blue" className={ACTION_BTN} onClick={() => openEditDatabase(db)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" />Edit
                        </Button>
                        <Button type="button" variant="success" className={ACTION_BTN}
                          onClick={() => void handleTestDatabase(db.id)} disabled={testingDbId === db.id}>
                          <TestTube2 className="mr-1 h-3.5 w-3.5" />
                          {testingDbId === db.id ? "Testing…" : "Test"}
                        </Button>
                        <Button type="button" variant="danger" className={ACTION_BTN}
                          onClick={() => void deleteDatabase(accessToken!, db.id).then(loadData)}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" />Remove
                        </Button>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Host</th>
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {databases.map((db) => (
                    <tr key={db.id} className="hover:bg-surface/50 transition-colors">
                      <td className="px-4 py-2 font-medium text-foreground">{dbDisplayName(db)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{dbTypeLabel[db.db_type]}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {db.db_type === "SQLITE"
                          ? sqliteHostLabel(db)
                          : `${db.host}:${db.port}`}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {db.db_type === "SQLITE" && db.sqlite_location !== "REMOTE" ? "Local" : db.username}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <Button type="button" variant="blue" className={ACTION_BTN} onClick={() => openEditDatabase(db)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" />Edit
                          </Button>
                          <Button type="button" variant="success" className={ACTION_BTN}
                            onClick={() => void handleTestDatabase(db.id)} disabled={testingDbId === db.id}>
                            <TestTube2 className="mr-1 h-3.5 w-3.5" />
                            {testingDbId === db.id ? "Testing…" : "Test"}
                          </Button>
                          <Button type="button" variant="danger" className={ACTION_BTN}
                            onClick={() => void deleteDatabase(accessToken!, db.id).then(loadData)}>
                            <Trash2 className="mr-1 h-3.5 w-3.5" />Remove
                          </Button>
                        </div>
                        {testResults[`db-${db.id}`] && (
                          <p className={`mt-1 text-xs ${testResults[`db-${db.id}`].success ? "text-success" : "text-failure"}`}>
                            {testResults[`db-${db.id}`].success ? "✓" : "✗"} {testResults[`db-${db.id}`].message}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && databases.length === 0 && (
            <p className="text-sm text-muted-foreground">No databases yet. Add a database to start backing it up.</p>
          )}

          <Modal open={openDatabase} onClose={() => setOpenDatabase(false)} title="Add Database">
            <form className="space-y-3" onSubmit={submitDatabase}>
              <p className="text-xs text-muted-foreground">
                Enter the connection details for the database you want to back up.
              </p>
              <Input placeholder="Name (database name)" value={databaseForm.name}
                onChange={(e) => setDatabaseForm((p) => ({ ...p, name: e.target.value }))} required />
              {databaseForm.db_type !== "SQLITE" && (
                <Input placeholder="Alias (display name)" value={databaseForm.alias}
                  onChange={(e) => setDatabaseForm((p) => ({ ...p, alias: e.target.value }))} required />
              )}
              <select
                className="h-12 w-full rounded-xl border border-border bg-white px-4 text-sm shadow-soft"
                value={databaseForm.db_type}
                onChange={(e) => setDatabaseForm((p) => ({ ...p, db_type: e.target.value as DatabaseType }))}
              >
                <option value="POSTGRES">PostgreSQL</option>
                <option value="MYSQL">MySQL</option>
                <option value="SQLITE">SQLite</option>
              </select>
              {databaseForm.db_type === "SQLITE" && (
                <>
                  <select
                    className="h-12 w-full rounded-xl border border-border bg-white px-4 text-sm shadow-soft"
                    value={databaseForm.sqlite_location}
                    onChange={(e) => setDatabaseForm((p) => ({
                      ...p,
                      sqlite_location: e.target.value as SqliteLocation,
                      port: e.target.value === "REMOTE" && p.port === 5432 ? 22 : p.port,
                    }))}
                  >
                    <option value="LOCAL">Local file</option>
                    <option value="REMOTE">Remote over SSH</option>
                  </select>
                  <Input placeholder="SQLite file path" value={databaseForm.sqlite_path}
                    onChange={(e) => setDatabaseForm((p) => ({ ...p, sqlite_path: e.target.value }))} required />
                </>
              )}
              {databaseForm.db_type === "SQLITE" ? (
                databaseForm.sqlite_location === "REMOTE" && (
                  <>
                    <Input placeholder="SSH host" value={databaseForm.host}
                      onChange={(e) => setDatabaseForm((p) => ({ ...p, host: e.target.value }))} required />
                    <Input type="number" placeholder="SSH port" value={databaseForm.port}
                      onChange={(e) => setDatabaseForm((p) => ({ ...p, port: Number(e.target.value) }))} required />
                    <Input placeholder="SSH username" value={databaseForm.username}
                      onChange={(e) => setDatabaseForm((p) => ({ ...p, username: e.target.value }))} required />
                    <Input type="password" placeholder="SSH password" value={databaseForm.password}
                      onChange={(e) => setDatabaseForm((p) => ({ ...p, password: e.target.value }))} />
                  </>
                )
              ) : (
                <>
                  <Input placeholder="Host (DB server address)" value={databaseForm.host}
                    onChange={(e) => setDatabaseForm((p) => ({ ...p, host: e.target.value }))} required />
                  <Input type="number" placeholder="Port" value={databaseForm.port}
                    onChange={(e) => setDatabaseForm((p) => ({ ...p, port: Number(e.target.value) }))} required />
                  <Input placeholder="Username" value={databaseForm.username}
                    onChange={(e) => setDatabaseForm((p) => ({ ...p, username: e.target.value }))} required />
                  <Input type="password" placeholder="Password" value={databaseForm.password}
                    onChange={(e) => setDatabaseForm((p) => ({ ...p, password: e.target.value }))} />
                </>
              )}
              {databaseCreateTestResult && (
                <p className={`text-xs ${databaseCreateTestResult.success ? "text-success" : "text-failure"}`}>
                  {databaseCreateTestResult.success ? "✓" : "✗"} {databaseCreateTestResult.message}
                </p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpenDatabase(false)}>Cancel</Button>
                <Button variant="success" type="button"
                  onClick={() => void handleTestCreateDatabaseForm()}
                  disabled={testingDatabaseCreate || (
                    databaseForm.db_type === "SQLITE"
                      ? (databaseForm.sqlite_location === "LOCAL"
                        ? !databaseForm.sqlite_path
                        : !databaseForm.host || !databaseForm.sqlite_path || !databaseForm.username || !databaseForm.port)
                      : !databaseForm.host || !databaseForm.username || !databaseForm.port
                  )}>
                  {testingDatabaseCreate ? "Testing…" : "Test Connection"}
                </Button>
                <Button type="submit">Create</Button>
              </div>
            </form>
          </Modal>

          <Modal open={editingDatabase !== null} onClose={() => setEditingDatabase(null)} title="Edit Database">
            <form className="space-y-3" onSubmit={submitEditDatabase}>
              <Input placeholder="Name (database name)" value={editDatabaseForm.name}
                onChange={(e) => setEditDatabaseForm((p) => ({ ...p, name: e.target.value }))} required />
              {editDatabaseForm.db_type !== "SQLITE" && (
                <Input placeholder="Alias (display name)" value={editDatabaseForm.alias}
                  onChange={(e) => setEditDatabaseForm((p) => ({ ...p, alias: e.target.value }))} required />
              )}
              <select
                className="h-12 w-full rounded-xl border border-border bg-white px-4 text-sm shadow-soft"
                value={editDatabaseForm.db_type}
                onChange={(e) => setEditDatabaseForm((p) => ({ ...p, db_type: e.target.value as DatabaseType }))}
              >
                <option value="POSTGRES">PostgreSQL</option>
                <option value="MYSQL">MySQL</option>
                <option value="SQLITE">SQLite</option>
              </select>
              {editDatabaseForm.db_type === "SQLITE" && (
                <>
                  <select
                    className="h-12 w-full rounded-xl border border-border bg-white px-4 text-sm shadow-soft"
                    value={editDatabaseForm.sqlite_location}
                    onChange={(e) => setEditDatabaseForm((p) => ({
                      ...p,
                      sqlite_location: e.target.value as SqliteLocation,
                      port: e.target.value === "REMOTE" && p.port === 5432 ? 22 : p.port,
                    }))}
                  >
                    <option value="LOCAL">Local file</option>
                    <option value="REMOTE">Remote over SSH</option>
                  </select>
                  <Input placeholder="SQLite file path" value={editDatabaseForm.sqlite_path}
                    onChange={(e) => setEditDatabaseForm((p) => ({ ...p, sqlite_path: e.target.value }))} required />
                </>
              )}
              {editDatabaseForm.db_type === "SQLITE" ? (
                editDatabaseForm.sqlite_location === "REMOTE" && (
                  <>
                    <Input placeholder="SSH host" value={editDatabaseForm.host}
                      onChange={(e) => setEditDatabaseForm((p) => ({ ...p, host: e.target.value }))} required />
                    <Input type="number" placeholder="SSH port" value={editDatabaseForm.port}
                      onChange={(e) => setEditDatabaseForm((p) => ({ ...p, port: Number(e.target.value) }))} required />
                    <Input placeholder="SSH username" value={editDatabaseForm.username}
                      onChange={(e) => setEditDatabaseForm((p) => ({ ...p, username: e.target.value }))} required />
                    <Input type="password" placeholder="New SSH password (leave blank to keep existing)" value={editDatabaseForm.password}
                      onChange={(e) => setEditDatabaseForm((p) => ({ ...p, password: e.target.value }))} />
                  </>
                )
              ) : (
                <>
                  <Input placeholder="Host (DB server address)" value={editDatabaseForm.host}
                    onChange={(e) => setEditDatabaseForm((p) => ({ ...p, host: e.target.value }))} required />
                  <Input type="number" placeholder="Port" value={editDatabaseForm.port}
                    onChange={(e) => setEditDatabaseForm((p) => ({ ...p, port: Number(e.target.value) }))} required />
                  <Input placeholder="Username" value={editDatabaseForm.username}
                    onChange={(e) => setEditDatabaseForm((p) => ({ ...p, username: e.target.value }))} required />
                  <Input type="password" placeholder="New password (leave blank to keep existing)" value={editDatabaseForm.password}
                    onChange={(e) => setEditDatabaseForm((p) => ({ ...p, password: e.target.value }))} />
                </>
              )}
              {databaseEditTestResult && (
                <p className={`text-xs ${databaseEditTestResult.success ? "text-success" : "text-failure"}`}>
                  {databaseEditTestResult.success ? "✓" : "✗"} {databaseEditTestResult.message}
                </p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" type="button" onClick={() => setEditingDatabase(null)}>Cancel</Button>
                <Button variant="success" type="button"
                  onClick={() => void handleTestEditDatabaseForm()}
                  disabled={testingDatabaseEdit || (
                    editDatabaseForm.db_type === "SQLITE"
                      ? (editDatabaseForm.sqlite_location === "LOCAL"
                        ? !editDatabaseForm.sqlite_path
                        : !editDatabaseForm.host || !editDatabaseForm.sqlite_path || !editDatabaseForm.username || !editDatabaseForm.port)
                      : !editDatabaseForm.host || !editDatabaseForm.username || !editDatabaseForm.port
                  )}>
                  {testingDatabaseEdit ? "Testing…" : "Test Connection"}
                </Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          </Modal>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* BACKUP CONFIGS TAB                                                   */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === "configs" && (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Backup schedules per database. Backups are stored locally by default.
            </p>
            <div className="flex items-center gap-2">
              <ViewToggle />
              <Button onClick={() => setOpenConfig(true)} disabled={databases.length === 0}>
                <Plus className="mr-2 h-4 w-4" />Add Config
              </Button>
            </div>
          </div>
          {databases.length === 0 && (
            <p className="mb-4 text-sm text-muted-foreground">Add a database first before creating a backup config.</p>
          )}

          {viewMode === "card" ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {configs.map((cfg, i) => {
                const db = dbById.get(cfg.database);
                const dayNames = cfg.backup_days_of_week && cfg.backup_days_of_week.length > 0
                  ? cfg.backup_days_of_week.map((d) => DAYS_OF_WEEK[d].short).join(", ")
                  : "Every day";
                return (
                  <motion.div key={cfg.id} initial={fadeUp.initial} animate={fadeUp.animate}
                    transition={reduceMotion ? { duration: 0 } : { ...defaultTransition, delay: i * 0.07 }}>
                    <Card className="group relative overflow-hidden hover:-translate-y-1 hover:shadow-hover transition-transform duration-200">
                      <div className="bg-gradient-accent absolute inset-x-0 top-0 h-1 opacity-70" />
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-foreground">
                            {db ? dbDisplayName(db) : `Database ${cfg.database}`}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">{minutesToDisplay(cfg.backup_frequency_minutes)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{dayNames}</p>
                          <p className="mt-1 text-xs text-muted-foreground">Retain {cfg.retention_days} days</p>
                          {cfg.retention_keep_monthly_first && (
                            <p className="mt-0.5 text-xs text-muted-foreground">+ Keep 1st of month</p>
                          )}
                          {cfg.retention_keep_weekly_day != null && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              + Keep {DAYS_OF_WEEK[cfg.retention_keep_weekly_day].label}s
                            </p>
                          )}
                          {cfg.retention_exception_days != null && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              + Keep one every {cfg.retention_exception_days}d
                            </p>
                          )}
                          {cfg.retention_exception_max_days != null && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              + Stop after {cfg.retention_exception_max_days}d
                            </p>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">
                            Last: {cfg.last_backup_at ? new Date(cfg.last_backup_at).toLocaleString() : "Never"}
                          </p>
                        </div>
                        <div className="ml-2 flex shrink-0 flex-col items-end gap-1.5">
                          <Button type="button" variant="danger" className={ACTION_BTN}
                            onClick={() => void deleteConfig(accessToken!, cfg.id).then(loadData)}>
                            <Trash2 className="mr-1 h-3.5 w-3.5" />Remove
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Database</th>
                    <th className="px-4 py-2 font-medium">Frequency</th>
                    <th className="px-4 py-2 font-medium">Schedule Days</th>
                    <th className="px-4 py-2 font-medium">Retain</th>
                    <th className="px-4 py-2 font-medium">Last Backup</th>
                    <th className="px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {configs.map((cfg) => {
                    const db = dbById.get(cfg.database);
                    const dayNames = cfg.backup_days_of_week && cfg.backup_days_of_week.length > 0
                      ? cfg.backup_days_of_week.map((d) => DAYS_OF_WEEK[d].short).join(", ")
                      : "Every day";
                    return (
                      <tr key={cfg.id} className="hover:bg-surface/50 transition-colors">
                        <td className="px-4 py-2 font-medium text-foreground">
                          {db ? dbDisplayName(db) : `Database ${cfg.database}`}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{minutesToDisplay(cfg.backup_frequency_minutes)}</td>
                        <td className="px-4 py-2 text-muted-foreground">{dayNames}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {cfg.retention_days}d
                          {cfg.retention_exception_days != null
                            ? ` (+${cfg.retention_exception_days}d${cfg.retention_exception_max_days != null ? ` / ${cfg.retention_exception_max_days}d` : ""})`
                            : ""}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground text-xs">
                          {cfg.last_backup_at ? new Date(cfg.last_backup_at).toLocaleString() : "Never"}
                        </td>
                        <td className="px-4 py-2">
                          <Button type="button" variant="danger" className={ACTION_BTN}
                            onClick={() => void deleteConfig(accessToken!, cfg.id).then(loadData)}>
                            <Trash2 className="mr-1 h-3.5 w-3.5" />Remove
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && configs.length === 0 && (
            <p className="text-sm text-muted-foreground">No backup configs yet.</p>
          )}

          <Modal open={openConfig} onClose={() => setOpenConfig(false)} title="Add Backup Config">
            <form className="space-y-3" onSubmit={submitConfig}>
              <p className="text-xs text-muted-foreground">
                Backups are stored locally on this server by default.
                Create a replication policy to also send them to a storage host.
              </p>
              {/* Database selector */}
              <select
                className="h-12 w-full rounded-xl border border-border bg-white px-4 text-sm shadow-soft"
                value={configForm.database || ""}
                onChange={(e) => setConfigForm((p) => ({ ...p, database: Number(e.target.value) }))}
                required
              >
                <option value="" disabled>Select database…</option>
                {databases.map((db) => (
                  <option key={db.id} value={db.id}>{dbDisplayName(db)} ({dbTypeLabel[db.db_type]})</option>
                ))}
              </select>
              {/* Frequency */}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Backup frequency</label>
                <div className="flex gap-2">
                  <Input type="number" placeholder="e.g. 1" className="flex-1"
                    value={configForm.frequencyValue}
                    onChange={(e) => setConfigForm((p) => ({ ...p, frequencyValue: Number(e.target.value) }))}
                    min={0} required />
                  <select
                    className="h-12 rounded-xl border border-border bg-white px-3 text-sm shadow-soft"
                    value={configForm.frequencyUnit}
                    onChange={(e) => setConfigForm((p) => ({ ...p, frequencyUnit: e.target.value as FreqUnit }))}
                  >
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  = {minutesToDisplay(freqToMinutes(configForm.frequencyValue, configForm.frequencyUnit))}
                </p>
              </div>
              {/* Days of week */}
              <div>
                <label className="mb-2 block text-xs text-muted-foreground">Run on (empty = every day)</label>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS_OF_WEEK.map((day) => {
                    const active = configForm.backup_days_of_week.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => setConfigForm((p) => ({
                          ...p,
                          backup_days_of_week: active
                            ? p.backup_days_of_week.filter((d) => d !== day.value)
                            : [...p.backup_days_of_week, day.value],
                        }))}
                        className={cn(
                          "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                          active
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border bg-white text-muted-foreground hover:border-accent/50"
                        )}
                      >
                        {day.short}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Retention */}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Retention period (days)</label>
                <Input type="number" placeholder="e.g. 7"
                  value={configForm.retention_days}
                  onChange={(e) => setConfigForm((p) => ({ ...p, retention_days: Number(e.target.value) }))}
                  min={1} required />
              </div>
              {/* Retention exceptions */}
              <div className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-xs font-medium text-foreground">Retention exceptions (always keep)</p>
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={configForm.retention_keep_monthly_first}
                    onChange={(e) => setConfigForm((p) => ({ ...p, retention_keep_monthly_first: e.target.checked }))}
                    className="rounded"
                  />
                  Keep backup from 1st of each month
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={configForm.retention_keep_weekly_day !== null}
                    onChange={(e) => setConfigForm((p) => ({
                      ...p,
                      retention_keep_weekly_day: e.target.checked ? 0 : null,
                    }))}
                    className="rounded"
                  />
                  Keep backup from a specific weekday
                </label>
                {configForm.retention_keep_weekly_day !== null && (
                  <select
                    className="h-9 w-full rounded-xl border border-border bg-white px-3 text-sm shadow-soft"
                    value={configForm.retention_keep_weekly_day}
                    onChange={(e) => setConfigForm((p) => ({ ...p, retention_keep_weekly_day: Number(e.target.value) }))}
                  >
                    {DAYS_OF_WEEK.map((day) => (
                      <option key={day.value} value={day.value}>{day.label}</option>
                    ))}
                  </select>
                )}
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Keep one every (days)</label>
                  <Input
                    type="number"
                    placeholder="e.g. 15"
                    value={configForm.retention_exception_days ?? ""}
                    onChange={(e) => setConfigForm((p) => ({
                      ...p,
                      retention_exception_days: e.target.value ? Number(e.target.value) : null,
                    }))}
                    min={1}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Stop after (days)</label>
                  <Input
                    type="number"
                    placeholder="e.g. 365"
                    value={configForm.retention_exception_max_days ?? ""}
                    onChange={(e) => setConfigForm((p) => ({
                      ...p,
                      retention_exception_max_days: e.target.value ? Number(e.target.value) : null,
                    }))}
                    min={1}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpenConfig(false)}>Cancel</Button>
                <Button type="submit">Create</Button>
              </div>
            </form>
          </Modal>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* REPLICATION POLICIES TAB                                            */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === "replication" && (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Replicate backups to a storage host via SFTP. Runs after each backup or on its own schedule.
            </p>
            <div className="flex items-center gap-2">
              <ViewToggle />
              <Button onClick={() => setOpenPolicy(true)} disabled={configs.length === 0 || storageHosts.length === 0}>
                <Plus className="mr-2 h-4 w-4" />Add Policy
              </Button>
            </div>
          </div>
          {(configs.length === 0 || storageHosts.length === 0) && (
            <p className="mb-4 text-sm text-muted-foreground">
              You need at least one backup config and one storage host before creating a replication policy.
            </p>
          )}

          {viewMode === "card" ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {policies.map((policy, i) => {
                const cfg = configById.get(policy.database_config);
                const db = cfg ? dbById.get(cfg.database) : undefined;
                const sh = storageHostById.get(policy.storage_host);
                const dayLabel = policy.replication_days_of_week && policy.replication_days_of_week.length > 0
                  ? policy.replication_days_of_week.map((d) => DAYS_OF_WEEK[d].short).join(", ")
                  : "";
                const scheduleLabel = policy.replication_frequency_minutes != null
                  ? `Every ${minutesToDisplay(policy.replication_frequency_minutes)}`
                  : "After every backup";
                return (
                  <motion.div key={policy.id} initial={fadeUp.initial} animate={fadeUp.animate}
                    transition={reduceMotion ? { duration: 0 } : { ...defaultTransition, delay: i * 0.07 }}>
                    <Card className="group relative overflow-hidden hover:-translate-y-1 hover:shadow-hover transition-transform duration-200">
                      <div className="bg-gradient-accent absolute inset-x-0 top-0 h-1 opacity-70" />
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-foreground">
                            {db?.name ?? `Config ${policy.database_config}`}
                            <span className="mx-2 text-muted-foreground">→</span>
                            {sh?.name ?? `Host ${policy.storage_host}`}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {scheduleLabel}{dayLabel ? ` · ${dayLabel}` : ""}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">Path: {policy.remote_path}</p>
                          {policy.replication_retention_days != null && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Retain replicas {policy.replication_retention_days}d
                            </p>
                          )}
                          {policy.replication_retention_exception_days != null && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Keep one every {policy.replication_retention_exception_days}d
                            </p>
                          )}
                          {policy.replication_retention_exception_max_days != null && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Stop after {policy.replication_retention_exception_max_days}d
                            </p>
                          )}
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {policy.enabled ? "Enabled" : "Disabled"}
                          </p>
                        </div>
                        <div className="ml-2 flex shrink-0 flex-col items-end gap-1.5">
                          <Button type="button" variant="danger" className={ACTION_BTN}
                            onClick={() => void deleteReplicationPolicy(accessToken!, policy.id).then(loadData)}>
                            <Trash2 className="mr-1 h-3.5 w-3.5" />Remove
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Database</th>
                    <th className="px-4 py-2 font-medium">Storage Host</th>
                    <th className="px-4 py-2 font-medium">Schedule</th>
                    <th className="px-4 py-2 font-medium">Replica Retention</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {policies.map((policy) => {
                    const cfg = configById.get(policy.database_config);
                    const db = cfg ? dbById.get(cfg.database) : undefined;
                    const sh = storageHostById.get(policy.storage_host);
                    const dayLabel = policy.replication_days_of_week && policy.replication_days_of_week.length > 0
                      ? policy.replication_days_of_week.map((d) => DAYS_OF_WEEK[d].short).join(", ")
                      : "";
                    const scheduleLabel = policy.replication_frequency_minutes != null
                      ? minutesToDisplay(policy.replication_frequency_minutes)
                      : "After backup";
                    return (
                      <tr key={policy.id} className="hover:bg-surface/50 transition-colors">
                        <td className="px-4 py-2 font-medium text-foreground">{db?.name ?? `Config ${policy.database_config}`}</td>
                        <td className="px-4 py-2 text-muted-foreground">{sh?.name ?? `Host ${policy.storage_host}`}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {scheduleLabel}{dayLabel ? ` · ${dayLabel}` : ""}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {policy.replication_retention_days != null
                            ? `${policy.replication_retention_days}d${policy.replication_retention_exception_days != null ? ` (+${policy.replication_retention_exception_days}d${policy.replication_retention_exception_max_days != null ? ` / ${policy.replication_retention_exception_max_days}d` : ""})` : ""}`
                            : "—"}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{policy.enabled ? "Enabled" : "Disabled"}</td>
                        <td className="px-4 py-2">
                          <Button type="button" variant="danger" className={ACTION_BTN}
                            onClick={() => void deleteReplicationPolicy(accessToken!, policy.id).then(loadData)}>
                            <Trash2 className="mr-1 h-3.5 w-3.5" />Remove
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && policies.length === 0 && (
            <p className="text-sm text-muted-foreground">No replication policies yet.</p>
          )}

          <Modal open={openPolicy} onClose={() => setOpenPolicy(false)} title="Add Replication Policy">
            <form className="space-y-3" onSubmit={submitPolicy}>
              <p className="text-xs text-muted-foreground">
                After a successful backup, copy the file to the selected storage host via SFTP.
              </p>
              {/* Backup config */}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Backup Config (database)</label>
                <select
                  className="h-12 w-full rounded-xl border border-border bg-white px-4 text-sm shadow-soft"
                  value={policyForm.database_config || ""}
                  onChange={(e) => setPolicyForm((p) => ({ ...p, database_config: Number(e.target.value) }))}
                  required
                >
                  <option value="" disabled>Select backup config…</option>
                  {configs.map((cfg) => {
                    const db = dbById.get(cfg.database);
                    return <option key={cfg.id} value={cfg.id}>{db?.name ?? `Config ${cfg.id}`}</option>;
                  })}
                </select>
              </div>
              {/* Storage host */}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Storage Host (SSH server)</label>
                <select
                  className="h-12 w-full rounded-xl border border-border bg-white px-4 text-sm shadow-soft"
                  value={policyForm.storage_host || ""}
                  onChange={(e) => setPolicyForm((p) => ({ ...p, storage_host: Number(e.target.value) }))}
                  required
                >
                  <option value="" disabled>Select storage host…</option>
                  {storageHosts.map((sh) => (
                    <option key={sh.id} value={sh.id}>{sh.name} ({sh.address})</option>
                  ))}
                </select>
              </div>
              <Input placeholder="Remote path (e.g. /backups/prod)" value={policyForm.remote_path}
                onChange={(e) => setPolicyForm((p) => ({ ...p, remote_path: e.target.value }))} required />
              {/* Independent schedule */}
              <div className="rounded-xl border border-border p-3 space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policyForm.hasIndependentSchedule}
                    onChange={(e) => setPolicyForm((p) => ({ ...p, hasIndependentSchedule: e.target.checked }))}
                    className="rounded"
                  />
                  Independent replication schedule (instead of after every backup)
                </label>
                {policyForm.hasIndependentSchedule && (
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Replicate every</label>
                    <div className="flex gap-2">
                      <Input type="number" placeholder="e.g. 6" className="flex-1"
                        value={policyForm.replicationFreqValue}
                        onChange={(e) => setPolicyForm((p) => ({ ...p, replicationFreqValue: Number(e.target.value) }))}
                        min={1} />
                      <select
                        className="h-12 rounded-xl border border-border bg-white px-3 text-sm shadow-soft"
                        value={policyForm.replicationFreqUnit}
                        onChange={(e) => setPolicyForm((p) => ({ ...p, replicationFreqUnit: e.target.value as FreqUnit }))}
                      >
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                      </select>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      = {minutesToDisplay(freqToMinutes(policyForm.replicationFreqValue, policyForm.replicationFreqUnit))}
                    </p>
                    <div className="mt-3">
                      <label className="mb-2 block text-xs text-muted-foreground">Run on (empty = every day)</label>
                      <div className="flex flex-wrap gap-1.5">
                        {DAYS_OF_WEEK.map((day) => {
                          const active = policyForm.replication_days_of_week.includes(day.value);
                          return (
                            <button
                              key={day.value}
                              type="button"
                              onClick={() => setPolicyForm((p) => ({
                                ...p,
                                replication_days_of_week: active
                                  ? p.replication_days_of_week.filter((d) => d !== day.value)
                                  : [...p.replication_days_of_week, day.value],
                              }))}
                              className={cn(
                                "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                                active
                                  ? "border-accent bg-accent/10 text-accent"
                                  : "border-border bg-white text-muted-foreground hover:border-accent/50"
                              )}
                            >
                              {day.short}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {/* Separate retention */}
              <div className="rounded-xl border border-border p-3 space-y-2">
                <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policyForm.replication_retention_days !== null}
                    onChange={(e) => setPolicyForm((p) => ({
                      ...p,
                      replication_retention_days: e.target.checked ? 30 : null,
                    }))}
                    className="rounded"
                  />
                  Separate retention for replicated copies
                </label>
                {policyForm.replication_retention_days !== null && (
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Retain replicas (days)</label>
                    <Input type="number" placeholder="e.g. 30"
                      value={policyForm.replication_retention_days}
                      onChange={(e) => setPolicyForm((p) => ({ ...p, replication_retention_days: Number(e.target.value) }))}
                      min={1} />
                    <label className="mb-1 mt-2 block text-xs text-muted-foreground">Keep one every (days)</label>
                    <Input
                      type="number"
                      placeholder="e.g. 15"
                      value={policyForm.replication_retention_exception_days ?? ""}
                      onChange={(e) => setPolicyForm((p) => ({
                        ...p,
                        replication_retention_exception_days: e.target.value ? Number(e.target.value) : null,
                      }))}
                      min={1}
                    />
                    <label className="mb-1 mt-2 block text-xs text-muted-foreground">Stop after (days)</label>
                    <Input
                      type="number"
                      placeholder="e.g. 365"
                      value={policyForm.replication_retention_exception_max_days ?? ""}
                      onChange={(e) => setPolicyForm((p) => ({
                        ...p,
                        replication_retention_exception_max_days: e.target.value ? Number(e.target.value) : null,
                      }))}
                      min={1}
                    />
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" type="button" onClick={() => setOpenPolicy(false)}>Cancel</Button>
                <Button type="submit">Create</Button>
              </div>
            </form>
          </Modal>
        </>
      )}
    </Section>
  );
}
