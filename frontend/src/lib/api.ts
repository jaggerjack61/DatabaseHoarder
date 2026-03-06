import {
  AuthTokens,
  Backup,
  CurrentUser,
  DashboardMetrics,
  Database,
  DatabaseConfig,
  DatabaseConfigVersion,
  DatabaseType,
  LiveBackupsResponse,
  LiveRestorationsResponse,
  ReplicationPolicy,
  ReplicationPolicyVersion,
  RestoreConfig,
  RestoreConfigVersion,
  RestoreJob,
  SiteSettings,
  StorageHost,
  TriggerBackupResponse,
  TriggerReplicationResponse,
  BackupDeletionRequest,
  UserAccount,
  AccessProfile,
  ConnectionStatusResponse,
} from "@/types/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
const ACCESS_TOKEN_KEY = "dbauto.access";
const REFRESH_TOKEN_KEY = "dbauto.refresh";
let unauthorizedHandler: (() => void) | null = null;

export function registerUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

function buildHeaders(token?: string, isJson = true) {
  return {
    ...(isJson ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...buildHeaders(token, options.body !== undefined),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    if (token && (response.status === 401 || response.status === 403)) {
      clearTokens();
      unauthorizedHandler?.();
    }

    let detail = "";
    try {
      const text = await response.text();
      try {
        const json = JSON.parse(text) as { detail?: string };
        detail = json.detail || "";
      } catch {
        detail = text;
      }
    } catch {
      // body unreadable — fall through to status-based message
    }
    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return null as T;
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function getStoredTokens(): AuthTokens | null {
  const access = localStorage.getItem(ACCESS_TOKEN_KEY);
  const refresh = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!access || !refresh) return null;
  return { access, refresh };
}

export function storeTokens(tokens: AuthTokens) {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function login(username: string, password: string) {
  return request<AuthTokens>("/api/auth/token/", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function getMe(accessToken: string) {
  return request<CurrentUser>("/api/users/me/", { method: "GET" }, accessToken);
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function getDashboardMetrics(accessToken: string) {
  return request<DashboardMetrics>("/api/dashboard/metrics/", { method: "GET" }, accessToken);
}

// ---------------------------------------------------------------------------
// Storage Hosts (SSH servers for backup replication)
// ---------------------------------------------------------------------------

export function getStorageHosts(accessToken: string) {
  return request<StorageHost[]>("/api/hosts/storage-hosts/", { method: "GET" }, accessToken);
}

export function createStorageHost(
  accessToken: string,
  payload: { name: string; address: string; ssh_port: number; username: string; password?: string; is_active: boolean },
) {
  return request<StorageHost>(
    "/api/hosts/storage-hosts/",
    { method: "POST", body: JSON.stringify({ ...payload, password: payload.password ?? "" }) },
    accessToken,
  );
}

export function updateStorageHost(accessToken: string, id: number, payload: Partial<StorageHost> & { password?: string }) {
  return request<StorageHost>(`/api/hosts/storage-hosts/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }, accessToken);
}

export function deleteStorageHost(accessToken: string, id: number) {
  return request<null>(`/api/hosts/storage-hosts/${id}/`, { method: "DELETE" }, accessToken);
}

export function testStorageHostConnection(accessToken: string, id: number) {
  return request<{ success: boolean; message: string }>(
    `/api/hosts/storage-hosts/${id}/test-connection/`,
    { method: "POST" },
    accessToken,
  );
}

export function testStorageHostConnectionByPayload(
  accessToken: string,
  payload: { address: string; ssh_port: number; username: string; password?: string },
) {
  return request<{ success: boolean; message: string }>(
    "/api/hosts/storage-hosts/test-connection/",
    { method: "POST", body: JSON.stringify({ ...payload, password: payload.password ?? "" }) },
    accessToken,
  );
}

// ---------------------------------------------------------------------------
// Databases (DB connections to back up)
// ---------------------------------------------------------------------------

export function getDatabases(accessToken: string) {
  return request<Database[]>("/api/hosts/databases/", { method: "GET" }, accessToken);
}

export function createDatabase(
  accessToken: string,
  payload: {
    name: string;
    alias: string;
    db_type: DatabaseType;
    host: string;
    port: number;
    username: string;
    password?: string;
    sqlite_location?: "LOCAL" | "REMOTE";
    sqlite_path?: string;
    is_active: boolean;
  },
) {
  return request<Database>(
    "/api/hosts/databases/",
    { method: "POST", body: JSON.stringify({ ...payload, password: payload.password ?? "" }) },
    accessToken,
  );
}

export function updateDatabase(accessToken: string, id: number, payload: Partial<Database> & { password?: string }) {
  return request<Database>(`/api/hosts/databases/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }, accessToken);
}

export function deleteDatabase(accessToken: string, id: number) {
  return request<null>(`/api/hosts/databases/${id}/`, { method: "DELETE" }, accessToken);
}

export function testDatabaseConnection(accessToken: string, id: number) {
  return request<{ success: boolean; message: string }>(
    `/api/hosts/databases/${id}/test-connection/`,
    { method: "POST" },
    accessToken,
  );
}

export function testDatabaseConnectionByPayload(
  accessToken: string,
  payload: {
    db_type: DatabaseType;
    host: string;
    port?: number;
    username?: string;
    password?: string;
    sqlite_location?: "LOCAL" | "REMOTE";
    sqlite_path?: string;
  },
) {
  return request<{ success: boolean; message: string }>(
    "/api/hosts/databases/test-connection/",
    { method: "POST", body: JSON.stringify({ ...payload, password: payload.password ?? "" }) },
    accessToken,
  );
}

export function getConnectionStatus(accessToken: string, options?: { force?: boolean }) {
  const query = options?.force ? "?force=1" : "";
  return request<ConnectionStatusResponse>(`/api/hosts/connections/status/${query}`, { method: "GET" }, accessToken);
}

// ---------------------------------------------------------------------------
// Database Configs (backup schedules per database)
// ---------------------------------------------------------------------------

export function getConfigs(accessToken: string) {
  return request<DatabaseConfig[]>("/api/hosts/configs/", { method: "GET" }, accessToken);
}

export function createConfig(
  accessToken: string,
  payload: {
    database: number;
    backup_frequency_minutes: number;
    retention_days: number;
    backup_days_of_week?: number[];
    retention_keep_monthly_first?: boolean;
    retention_keep_weekly_day?: number | null;
    retention_exception_days?: number | null;
    retention_exception_max_days?: number | null;
    enabled: boolean;
    schedule_for_date?: string;
    is_one_time_event?: boolean;
  },
) {
  return request<DatabaseConfig>("/api/hosts/configs/", { method: "POST", body: JSON.stringify(payload) }, accessToken);
}

export function updateConfig(accessToken: string, id: number, payload: Partial<DatabaseConfig>) {
  return request<DatabaseConfig>(`/api/hosts/configs/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }, accessToken);
}

export function deleteConfig(accessToken: string, id: number) {
  return request<null>(`/api/hosts/configs/${id}/`, { method: "DELETE" }, accessToken);
}

export function getConfigVersions(accessToken: string) {
  return request<DatabaseConfigVersion[]>("/api/hosts/config-versions/", { method: "GET" }, accessToken);
}

// ---------------------------------------------------------------------------
// Replication Policies
// ---------------------------------------------------------------------------

export function getReplicationPolicies(accessToken: string) {
  return request<ReplicationPolicy[]>("/api/hosts/replication-policies/", { method: "GET" }, accessToken);
}

export function createReplicationPolicy(
  accessToken: string,
  payload: {
    database_config: number;
    storage_host: number;
    remote_path: string;
    enabled: boolean;
    replication_frequency_minutes?: number | null;
    replication_days_of_week?: number[];
    replication_retention_days?: number | null;
    replication_retention_exception_days?: number | null;
    replication_retention_exception_max_days?: number | null;
    schedule_for_date?: string;
    is_one_time_event?: boolean;
  },
) {
  return request<ReplicationPolicy>("/api/hosts/replication-policies/", { method: "POST", body: JSON.stringify(payload) }, accessToken);
}

export function deleteReplicationPolicy(accessToken: string, id: number) {
  return request<null>(`/api/hosts/replication-policies/${id}/`, { method: "DELETE" }, accessToken);
}

export function updateReplicationPolicy(accessToken: string, id: number, payload: Partial<ReplicationPolicy>) {
  return request<ReplicationPolicy>(`/api/hosts/replication-policies/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }, accessToken);
}

export function getReplicationPolicyVersions(accessToken: string) {
  return request<ReplicationPolicyVersion[]>("/api/hosts/replication-policy-versions/", { method: "GET" }, accessToken);
}

// ---------------------------------------------------------------------------
// Restore Configs
// ---------------------------------------------------------------------------

export function getRestoreConfigs(accessToken: string) {
  return request<RestoreConfig[]>("/api/hosts/restore-configs/", { method: "GET" }, accessToken);
}

export function createRestoreConfig(
  accessToken: string,
  payload: {
    source_config: number;
    target_database: number;
    restore_frequency_minutes: number;
    restore_days_of_week?: number[];
    drop_target_on_success?: boolean;
    enabled: boolean;
    schedule_for_date?: string;
    is_one_time_event?: boolean;
  },
) {
  return request<RestoreConfig>("/api/hosts/restore-configs/", { method: "POST", body: JSON.stringify(payload) }, accessToken);
}

export function updateRestoreConfig(accessToken: string, id: number, payload: Partial<RestoreConfig>) {
  return request<RestoreConfig>(`/api/hosts/restore-configs/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }, accessToken);
}

export function deleteRestoreConfig(accessToken: string, id: number) {
  return request<null>(`/api/hosts/restore-configs/${id}/`, { method: "DELETE" }, accessToken);
}

export function getRestoreConfigVersions(accessToken: string) {
  return request<RestoreConfigVersion[]>("/api/hosts/restore-config-versions/", { method: "GET" }, accessToken);
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export function getBackups(accessToken: string) {
  return request<Backup[]>("/api/backups/", { method: "GET" }, accessToken);
}

export function triggerBackup(accessToken: string, databaseConfigId: number) {
  return request<TriggerBackupResponse>(
    "/api/backups/trigger/",
    { method: "POST", body: JSON.stringify({ database_config: databaseConfigId }) },
    accessToken,
  );
}

export function getLiveBackups(accessToken: string) {
  return request<LiveBackupsResponse>("/api/backups/live/", { method: "GET" }, accessToken);
}

export function getLiveRestorations(accessToken: string) {
  return request<LiveRestorationsResponse>("/api/backups/live-restorations/", { method: "GET" }, accessToken);
}

export function getRestoreJobs(accessToken: string) {
  return request<RestoreJob[]>("/api/backups/restores/", { method: "GET" }, accessToken);
}

export function restoreBackup(
  accessToken: string,
  backupId: number,
  payload: { target_db: string; confirmation_phrase: string },
) {
  return request<{ status: string; backup_id: number; target_db: string }>(
    `/api/backups/${backupId}/restore/`,
    { method: "POST", body: JSON.stringify(payload) },
    accessToken,
  );
}

export function deleteBackup(
  accessToken: string,
  backupId: number,
  payload: { confirmation_phrase: string; delete_replications: boolean },
) {
  return request<{ status?: string; backup_id?: number; deletion_request_id?: number }>(
    `/api/backups/${backupId}/manual_delete/`,
    { method: "DELETE", body: JSON.stringify(payload) },
    accessToken,
  );
}

export function replicateBackup(accessToken: string, backupId: number, storageHostIds: number[]) {
  return request<TriggerReplicationResponse>(
    `/api/backups/${backupId}/replicate/`,
    { method: "POST", body: JSON.stringify({ storage_host_ids: storageHostIds }) },
    accessToken,
  );
}

export function getBackupDeletionRequests(accessToken: string) {
  return request<BackupDeletionRequest[]>("/api/backups/deletion-requests/", { method: "GET" }, accessToken);
}

export function reviewBackupDeletionRequest(
  accessToken: string,
  requestId: number,
  payload: { action: "APPROVED" | "DENIED"; admin_note?: string },
) {
  return request<{ status: "APPROVED" | "DENIED"; deletion_request_id: number }>(
    `/api/backups/deletion-requests/${requestId}/review/`,
    { method: "POST", body: JSON.stringify(payload) },
    accessToken,
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function getUsers(accessToken: string) {
  return request<UserAccount[]>("/api/users/", { method: "GET" }, accessToken);
}

export function createUser(
  accessToken: string,
  payload: {
    username: string;
    email: string;
    password: string;
    role: "ADMIN" | "USER";
    access_profile?: number | null;
    granted_storage_hosts?: number[];
    granted_databases?: number[];
    granted_database_configs?: number[];
  },
) {
  return request<UserAccount>("/api/users/", { method: "POST", body: JSON.stringify(payload) }, accessToken);
}

export function updateUser(
  accessToken: string,
  userId: number,
  payload: Partial<{
    username: string;
    email: string;
    role: "ADMIN" | "USER";
    is_active: boolean;
    access_profile: number | null;
    granted_storage_hosts: number[];
    granted_databases: number[];
    granted_database_configs: number[];
  }>,
) {
  return request<UserAccount>(`/api/users/${userId}/`, { method: "PATCH", body: JSON.stringify(payload) }, accessToken);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getSiteSettings(accessToken: string) {
  return request<SiteSettings>("/api/settings/", { method: "GET" }, accessToken);
}

export function updateSiteSettings(accessToken: string, payload: Partial<SiteSettings>) {
  return request<SiteSettings>("/api/settings/", { method: "PATCH", body: JSON.stringify(payload) }, accessToken);
}

export function resetThrottles(accessToken: string) {
  return request<{ cleared: number }>("/api/settings/reset-throttles/", { method: "POST" }, accessToken);
}

export function changePassword(accessToken: string, oldPassword: string, newPassword: string) {
  return request<{ detail: string }>(
    "/api/users/change-password/",
    { method: "POST", body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }) },
    accessToken,
  );
}

export function getPasswordRules(accessToken: string) {
  return request<{ rules: string[] }>("/api/users/password-rules/", { method: "GET" }, accessToken);
}

export function getAccessProfiles(accessToken: string) {
  return request<AccessProfile[]>("/api/users/access-profiles/", { method: "GET" }, accessToken);
}

export function createAccessProfile(
  accessToken: string,
  payload: {
    name: string;
    description?: string;
    granted_storage_hosts?: number[];
    granted_databases?: number[];
    granted_database_configs?: number[];
  },
) {
  return request<AccessProfile>("/api/users/access-profiles/", { method: "POST", body: JSON.stringify(payload) }, accessToken);
}

export function updateAccessProfile(
  accessToken: string,
  id: number,
  payload: Partial<{
    name: string;
    description: string;
    granted_storage_hosts: number[];
    granted_databases: number[];
    granted_database_configs: number[];
  }>,
) {
  return request<AccessProfile>(`/api/users/access-profiles/${id}/`, { method: "PATCH", body: JSON.stringify(payload) }, accessToken);
}
