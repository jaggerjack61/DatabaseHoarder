import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ChevronDown, ChevronRight, KeySquare, Shield, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Section } from "@/components/ui/Section";
import { useAuth } from "@/context/AuthContext";
import {
  changePassword,
  createAccessProfile,
  createUser,
  getAccessProfiles,
  getConfigs,
  getPasswordRules,
  getSiteSettings,
  getStorageHosts,
  getUsers,
  getDatabases,
  resetThrottles,
  updateAccessProfile,
  updateUser,
  updateSiteSettings,
} from "@/lib/api";
import { AccessProfile, Database, DatabaseConfig, SiteSettings, StorageHost, UserAccount } from "@/types/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-4 sm:flex-row sm:items-start sm:gap-6">
      <div className="w-full sm:w-56 shrink-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-6 shadow-soft">
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>;
}

function Divider() {
  return <hr className="border-border" />;
}

function CollapsibleGroup({
  title,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground"
      >
        <span>{title}</span>
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {isOpen && <div className="mt-2 grid gap-1">{children}</div>}
    </div>
  );
}

function Feedback({ message, isError }: { message: string | null; isError?: boolean }) {
  if (!message) return null;
  return (
    <p className={`mt-2 text-sm ${isError ? "text-failure" : "text-success"}`}>
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Profile section
// ---------------------------------------------------------------------------

function ProfileSection() {
  const { accessToken } = useAuth();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [passwordRules, setPasswordRules] = useState<string[]>([]);

  useEffect(() => {
    if (!accessToken) return;
    void getPasswordRules(accessToken)
      .then((res) => setPasswordRules(res.rules))
      .catch(() => {
        setPasswordRules(["Password must be at least 8 characters."]);
      });
  }, [accessToken]);

  const handleSubmit = async () => {
    if (!accessToken) return;
    setMessage(null);

    if (newPw !== confirmPw) {
      setIsError(true);
      setMessage("New passwords do not match.");
      return;
    }
    if (newPw.length < 8) {
      setIsError(true);
      setMessage("New password must be at least 8 characters.");
      return;
    }

    setSaving(true);
    try {
      const res = await changePassword(accessToken, oldPw, newPw);
      setIsError(false);
      setMessage(res.detail);
      setOldPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardTitle>Profile</CardTitle>
      <Divider />

      <SettingRow label="Change Password" hint="Requirements are shown below and enforced before save.">
        <div className="space-y-2 max-w-sm">
          <Input
            type="password"
            placeholder="Current password"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
          />
          <Input
            type="password"
            placeholder="New password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Confirm new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
          />
          <ul className="space-y-1 pt-1 text-xs text-muted-foreground">
            {passwordRules.map((rule) => (
              <li key={rule}>• {rule}</li>
            ))}
          </ul>
          <div className="pt-1">
            <Button size="sm" onClick={() => void handleSubmit()} disabled={saving || !oldPw || !newPw || !confirmPw}>
              {saving ? "Saving…" : "Update Password"}
            </Button>
          </div>
          <Feedback message={message} isError={isError} />
        </div>
      </SettingRow>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// System section (admin only)
// ---------------------------------------------------------------------------

function SystemSection() {
  const { accessToken } = useAuth();
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [form, setForm] = useState<SiteSettings>({
    restore_throttle_rate: "",
    manual_backup_throttle_rate: "",
    backup_execution_mode: "auto",
    connection_check_interval_seconds: 300,
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void getSiteSettings(accessToken).then((s) => {
      setSettings(s);
      setForm({ ...s });
    });
  }, [accessToken]);

  const handleSave = async () => {
    if (!accessToken) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const updated = await updateSiteSettings(accessToken, form);
      setSettings(updated);
      setForm({ ...updated });
      setSaveErr(false);
      setSaveMsg("Settings saved.");
    } catch (err) {
      setSaveErr(true);
      setSaveMsg(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!accessToken) return;
    setResetting(true);
    setResetMsg(null);
    try {
      const res = await resetThrottles(accessToken);
      setResetMsg(`Cleared ${res.cleared} throttle counter${res.cleared !== 1 ? "s" : ""}.`);
    } catch (err) {
      setResetMsg(err instanceof Error ? err.message : "Failed to reset.");
    } finally {
      setResetting(false);
    }
  };

  const isDirty = settings !== null && (
    form.restore_throttle_rate !== settings.restore_throttle_rate ||
    form.manual_backup_throttle_rate !== settings.manual_backup_throttle_rate ||
    form.backup_execution_mode !== settings.backup_execution_mode ||
    form.connection_check_interval_seconds !== settings.connection_check_interval_seconds
  );

  return (
    <Card>
      <CardTitle>System</CardTitle>
      <p className="mb-2 text-xs text-muted-foreground">
        Backup Engine Mode controls how PostgreSQL/MySQL backups and restores run.
        <span className="font-medium text-foreground"> Native CLI</span> provides production-grade parity with
        <span className="font-medium text-foreground"> pg_dump/mysqldump</span> formats and behavior.
      </p>
      <Divider />

      <SettingRow
        label="Backup Engine Mode"
        hint="Choose python for no external binaries, native for full parity, or auto to prefer native and fall back to python."
      >
        <div className="max-w-sm space-y-2">
          <select
            className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm"
            value={form.backup_execution_mode}
            onChange={(e) => setForm((f) => ({ ...f, backup_execution_mode: e.target.value as SiteSettings["backup_execution_mode"] }))}
          >
            <option value="auto">Auto (Prefer Native)</option>
            <option value="native">Native CLI (pg_dump / mysqldump parity)</option>
            <option value="python">Python Modules Only</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Auto uses native tools when installed and falls back to Python mode if unavailable.
          </p>
        </div>
      </SettingRow>

      <Divider />

      <SettingRow
        label="Connection Check Interval"
        hint="Polling interval in seconds for connection health checks."
      >
        <Input
          className="max-w-xs"
          type="number"
          min={15}
          value={form.connection_check_interval_seconds}
          onChange={(e) => setForm((f) => ({ ...f, connection_check_interval_seconds: Number(e.target.value) }))}
        />
      </SettingRow>

      <Divider />

      <CardTitle>Rate Limits</CardTitle>
      <p className="mb-2 text-xs text-muted-foreground">
        Format: <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">N/period</code> where period is{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">second</code>,{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">minute</code>,{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">hour</code>, or{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">day</code>.
      </p>
      <Divider />

      <SettingRow
        label="Restore Throttle"
        hint="Max restore requests per user."
      >
        <Input
          className="max-w-xs"
          placeholder="e.g. 30/hour"
          value={form.restore_throttle_rate}
          onChange={(e) => setForm((f) => ({ ...f, restore_throttle_rate: e.target.value }))}
        />
      </SettingRow>

      <Divider />

      <SettingRow
        label="Manual Backup Throttle"
        hint="Max manual trigger requests per user."
      >
        <Input
          className="max-w-xs"
          placeholder="e.g. 60/hour"
          value={form.manual_backup_throttle_rate}
          onChange={(e) => setForm((f) => ({ ...f, manual_backup_throttle_rate: e.target.value }))}
        />
      </SettingRow>

      <Divider />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void handleSave()} disabled={saving || !isDirty}>
          {saving ? "Saving…" : "Save System Settings"}
        </Button>
        <Feedback message={saveMsg} isError={saveErr} />
      </div>

      <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-sm font-medium text-foreground">Throttle Counters</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Clear all active rate-limit counters in Redis. Use this after reducing a rate to immediately
          unblock users, or after changing throttle values.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" variant="secondary" onClick={() => void handleReset()} disabled={resetting}>
            {resetting ? "Clearing…" : "Reset All Throttle Counters"}
          </Button>
          {resetMsg && <span className="text-xs text-muted-foreground">{resetMsg}</span>}
        </div>
      </div>
    </Card>
  );
}

function UserManagementSection() {
  const { accessToken } = useAuth();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [accessProfiles, setAccessProfiles] = useState<AccessProfile[]>([]);
  const [storageHosts, setStorageHosts] = useState<StorageHost[]>([]);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [configs, setConfigs] = useState<DatabaseConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const [newUser, setNewUser] = useState({ username: "", email: "", password: "", role: "USER" as "ADMIN" | "USER", access_profile: null as number | null });
  const [profileForm, setProfileForm] = useState({ name: "", description: "" });
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [profileAccessForm, setProfileAccessForm] = useState({
    granted_storage_hosts: [] as number[],
    granted_databases: [] as number[],
    granted_database_configs: [] as number[],
  });
  const [profilePanelsOpen, setProfilePanelsOpen] = useState({
    storageHosts: true,
    databases: true,
    configs: true,
  });
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [accessForm, setAccessForm] = useState({
    access_profile: null as number | null,
    granted_storage_hosts: [] as number[],
    granted_databases: [] as number[],
    granted_database_configs: [] as number[],
  });
  const [userPanelsOpen, setUserPanelsOpen] = useState({
    storageHosts: true,
    databases: true,
    configs: true,
  });
  const [activeTab, setActiveTab] = useState<"create" | "profiles" | "assign">("create");

  const load = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [userRows, profileRows, hostRows, dbRows, cfgRows] = await Promise.all([
        getUsers(accessToken),
        getAccessProfiles(accessToken),
        getStorageHosts(accessToken),
        getDatabases(accessToken),
        getConfigs(accessToken),
      ]);
      setUsers(userRows);
      setAccessProfiles(profileRows);
      setStorageHosts(hostRows);
      setDatabases(dbRows);
      setConfigs(cfgRows);
      if (!selectedProfileId && profileRows.length > 0) {
        setSelectedProfileId(profileRows[0].id);
      }
      if (!selectedUserId && userRows.length > 0) {
        const firstManageable = userRows.find((user) => user.role === "USER");
        setSelectedUserId(firstManageable?.id ?? null);
      }
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken]);

  useEffect(() => {
    const selected = users.find((user) => user.id === selectedUserId);
    if (!selected) return;
    setAccessForm({
      access_profile: selected.access_profile,
      granted_storage_hosts: selected.granted_storage_hosts,
      granted_databases: selected.granted_databases,
      granted_database_configs: selected.granted_database_configs,
    });
  }, [selectedUserId, users]);

  useEffect(() => {
    const selected = accessProfiles.find((profile) => profile.id === selectedProfileId);
    if (!selected) return;
    setProfileAccessForm({
      granted_storage_hosts: selected.granted_storage_hosts,
      granted_databases: selected.granted_databases,
      granted_database_configs: selected.granted_database_configs,
    });
  }, [selectedProfileId, accessProfiles]);

  const toggle = (field: "granted_storage_hosts" | "granted_databases" | "granted_database_configs", id: number) => {
    setAccessForm((prev) => {
      const current = prev[field];
      return {
        ...prev,
        [field]: current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id],
      };
    });
  };

  const handleCreateUser = async () => {
    if (!accessToken) return;
    setMessage(null);
    try {
      await createUser(accessToken, newUser);
      setIsError(false);
      setMessage("User created.");
      setNewUser({ username: "", email: "", password: "", role: "USER", access_profile: null });
      await load();
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : "Failed to create user.");
    }
  };

  const handleSaveAccess = async () => {
    if (!accessToken || !selectedUserId) return;
    setMessage(null);
    try {
      await updateUser(accessToken, selectedUserId, {
        access_profile: accessForm.access_profile,
        granted_storage_hosts: accessForm.granted_storage_hosts,
        granted_databases: accessForm.granted_databases,
        granted_database_configs: accessForm.granted_database_configs,
      });
      setIsError(false);
      setMessage("Access grants saved.");
      await load();
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : "Failed to save access grants.");
    }
  };

  const handleCreateProfile = async () => {
    if (!accessToken) return;
    setMessage(null);
    try {
      await createAccessProfile(accessToken, {
        name: profileForm.name,
        description: profileForm.description,
      });
      setIsError(false);
      setMessage("Access profile created.");
      setProfileForm({ name: "", description: "" });
      await load();
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : "Failed to create access profile.");
    }
  };

  const handleSaveProfileAccess = async () => {
    if (!accessToken || !selectedProfileId) return;
    setMessage(null);
    try {
      await updateAccessProfile(accessToken, selectedProfileId, {
        granted_storage_hosts: profileAccessForm.granted_storage_hosts,
        granted_databases: profileAccessForm.granted_databases,
        granted_database_configs: profileAccessForm.granted_database_configs,
      });
      setIsError(false);
      setMessage("Profile access saved.");
      await load();
    } catch (err) {
      setIsError(true);
      setMessage(err instanceof Error ? err.message : "Failed to save profile access.");
    }
  };

  return (
    <Card>
      <CardTitle>User Management</CardTitle>
      <Divider />

      <div className="mb-6 flex gap-2 border-b border-border">
        {[
          { id: "create", label: "Create User", icon: UserPlus },
          { id: "profiles", label: "Access Profiles", icon: Shield },
          { id: "assign", label: "Assign Access", icon: KeySquare },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as "create" | "profiles" | "assign")}
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

      {activeTab === "create" && (
        <SettingRow label="Create User" hint="Users cannot access Settings and can only see resources assigned below.">
          <div className="max-w-xl space-y-2">
            <Input placeholder="Username" value={newUser.username} onChange={(e) => setNewUser((prev) => ({ ...prev, username: e.target.value }))} />
            <Input placeholder="Email" value={newUser.email} onChange={(e) => setNewUser((prev) => ({ ...prev, email: e.target.value }))} />
            <Input type="password" placeholder="Temporary password" value={newUser.password} onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))} />
            <select
              className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm"
              value={newUser.role}
              onChange={(e) => setNewUser((prev) => ({ ...prev, role: e.target.value as "ADMIN" | "USER" }))}
            >
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <select
              className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm"
              value={newUser.access_profile ?? ""}
              onChange={(e) => setNewUser((prev) => ({ ...prev, access_profile: e.target.value ? Number(e.target.value) : null }))}
            >
              <option value="">No access profile</option>
              {accessProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
            <Button size="sm" onClick={() => void handleCreateUser()} disabled={!newUser.username || !newUser.password}>
              Add User
            </Button>
          </div>
        </SettingRow>
      )}

      {activeTab === "profiles" && (
        <SettingRow label="Access Profiles" hint="Create reusable profiles and assign them to users.">
          <div className="space-y-3">
            <div className="max-w-xl space-y-2">
              <Input
                placeholder="Profile name"
                value={profileForm.name}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, name: e.target.value }))}
              />
              <Input
                placeholder="Description (optional)"
                value={profileForm.description}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, description: e.target.value }))}
              />
              <Button size="sm" variant="secondary" onClick={() => void handleCreateProfile()} disabled={!profileForm.name}>
                Create Profile
              </Button>
            </div>

            <select
              className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm"
              value={selectedProfileId ?? ""}
              onChange={(e) => setSelectedProfileId(Number(e.target.value))}
              disabled={loading || accessProfiles.length === 0}
            >
              <option value="" disabled>{accessProfiles.length ? "Select profile" : "No profiles yet"}</option>
              {accessProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>

            {selectedProfileId && (
              <>
                <CollapsibleGroup
                  title="Storage Hosts"
                  isOpen={profilePanelsOpen.storageHosts}
                  onToggle={() => setProfilePanelsOpen((prev) => ({ ...prev, storageHosts: !prev.storageHosts }))}
                >
                  {storageHosts.map((host) => (
                    <label key={host.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={profileAccessForm.granted_storage_hosts.includes(host.id)}
                        onChange={() => setProfileAccessForm((prev) => ({
                          ...prev,
                          granted_storage_hosts: prev.granted_storage_hosts.includes(host.id)
                            ? prev.granted_storage_hosts.filter((itemId) => itemId !== host.id)
                            : [...prev.granted_storage_hosts, host.id],
                        }))}
                      />
                      {host.name}
                    </label>
                  ))}
                </CollapsibleGroup>

                <CollapsibleGroup
                  title="Databases"
                  isOpen={profilePanelsOpen.databases}
                  onToggle={() => setProfilePanelsOpen((prev) => ({ ...prev, databases: !prev.databases }))}
                >
                  {databases.map((db) => (
                    <label key={db.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={profileAccessForm.granted_databases.includes(db.id)}
                        onChange={() => setProfileAccessForm((prev) => ({
                          ...prev,
                          granted_databases: prev.granted_databases.includes(db.id)
                            ? prev.granted_databases.filter((itemId) => itemId !== db.id)
                            : [...prev.granted_databases, db.id],
                        }))}
                      />
                      {db.name}
                    </label>
                  ))}
                </CollapsibleGroup>

                <CollapsibleGroup
                  title="Backup Configurations"
                  isOpen={profilePanelsOpen.configs}
                  onToggle={() => setProfilePanelsOpen((prev) => ({ ...prev, configs: !prev.configs }))}
                >
                  {configs.map((cfg) => (
                    <label key={cfg.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={profileAccessForm.granted_database_configs.includes(cfg.id)}
                        onChange={() => setProfileAccessForm((prev) => ({
                          ...prev,
                          granted_database_configs: prev.granted_database_configs.includes(cfg.id)
                            ? prev.granted_database_configs.filter((itemId) => itemId !== cfg.id)
                            : [...prev.granted_database_configs, cfg.id],
                        }))}
                      />
                      Config #{cfg.id}
                    </label>
                  ))}
                </CollapsibleGroup>

                <Button size="sm" onClick={() => void handleSaveProfileAccess()}>Save Profile Access</Button>
              </>
            )}
          </div>
        </SettingRow>
      )}

      {activeTab === "assign" && (
        <SettingRow label="Assign Access" hint="Grant only the hosts, databases, and configs this user may manage.">
          <div className="space-y-3">
            <select
              className="h-10 w-full rounded-xl border border-border bg-white px-3 text-sm"
              value={selectedUserId ?? ""}
              onChange={(e) => setSelectedUserId(Number(e.target.value))}
              disabled={loading}
            >
              <option value="" disabled>Select user</option>
              {users.filter((user) => user.role === "USER").map((user) => (
                <option key={user.id} value={user.id}>{user.username}</option>
              ))}
            </select>

            {selectedUserId && (
              <>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Access Profile</p>
                  <select
                    className="mt-2 h-10 w-full rounded-xl border border-border bg-white px-3 text-sm"
                    value={accessForm.access_profile ?? ""}
                    onChange={(e) => setAccessForm((prev) => ({ ...prev, access_profile: e.target.value ? Number(e.target.value) : null }))}
                  >
                    <option value="">No profile (direct grants only)</option>
                    {accessProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.name}</option>
                    ))}
                  </select>
                </div>

                <CollapsibleGroup
                  title="Storage Hosts"
                  isOpen={userPanelsOpen.storageHosts}
                  onToggle={() => setUserPanelsOpen((prev) => ({ ...prev, storageHosts: !prev.storageHosts }))}
                >
                  {storageHosts.map((host) => (
                    <label key={host.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={accessForm.granted_storage_hosts.includes(host.id)}
                        onChange={() => toggle("granted_storage_hosts", host.id)}
                      />
                      {host.name}
                    </label>
                  ))}
                </CollapsibleGroup>

                <CollapsibleGroup
                  title="Databases"
                  isOpen={userPanelsOpen.databases}
                  onToggle={() => setUserPanelsOpen((prev) => ({ ...prev, databases: !prev.databases }))}
                >
                  {databases.map((db) => (
                    <label key={db.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={accessForm.granted_databases.includes(db.id)}
                        onChange={() => toggle("granted_databases", db.id)}
                      />
                      {db.name}
                    </label>
                  ))}
                </CollapsibleGroup>

                <CollapsibleGroup
                  title="Backup Configurations"
                  isOpen={userPanelsOpen.configs}
                  onToggle={() => setUserPanelsOpen((prev) => ({ ...prev, configs: !prev.configs }))}
                >
                  {configs.map((cfg) => (
                    <label key={cfg.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={accessForm.granted_database_configs.includes(cfg.id)}
                        onChange={() => toggle("granted_database_configs", cfg.id)}
                      />
                      Config #{cfg.id}
                    </label>
                  ))}
                </CollapsibleGroup>

                <Button size="sm" onClick={() => void handleSaveAccess()}>Save Access Grants</Button>
              </>
            )}
          </div>
        </SettingRow>
      )}

      <Feedback message={message} isError={isError} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<"profile" | "system" | "users">("profile");

  if (loading) {
    return (
      <Section label="settings" title="Settings">
        <p className="text-sm text-muted-foreground">Loading settings...</p>
      </Section>
    );
  }

  if (user?.role !== "ADMIN") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Section label="settings" title="Settings">
      <div className="space-y-6 max-w-3xl">
        <div className="mb-2 flex gap-2 border-b border-border">
          <button
            onClick={() => setActiveTab("profile")}
            className={`flex items-center gap-2 border-b-2 px-4 pb-3 pt-1 text-sm font-medium transition ${
              activeTab === "profile"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Profile
          </button>
          <button
            onClick={() => setActiveTab("system")}
            className={`flex items-center gap-2 border-b-2 px-4 pb-3 pt-1 text-sm font-medium transition ${
              activeTab === "system"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            System
          </button>
          <button
            onClick={() => setActiveTab("users")}
            className={`flex items-center gap-2 border-b-2 px-4 pb-3 pt-1 text-sm font-medium transition ${
              activeTab === "users"
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            User Management
          </button>
        </div>

        {activeTab === "profile" && <ProfileSection />}
        {activeTab === "system" && user?.role === "ADMIN" && <SystemSection />}
        {activeTab === "users" && user?.role === "ADMIN" && <UserManagementSection />}
      </div>
    </Section>
  );
}
