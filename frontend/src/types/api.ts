export type UserRole = "ADMIN" | "USER";

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface CurrentUser {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  date_joined: string;
}

export interface UserAccount {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  date_joined: string;
  access_profile: number | null;
  granted_storage_hosts: number[];
  granted_databases: number[];
  granted_database_configs: number[];
}

export interface AccessProfile {
  id: number;
  name: string;
  description: string;
  granted_storage_hosts: number[];
  granted_databases: number[];
  granted_database_configs: number[];
}

/** SSH server used to store replicated backup files. Unrelated to databases. */
export interface StorageHost {
  id: number;
  name: string;
  address: string;
  ssh_port: number;
  username: string;
  owner: number;
  is_active: boolean;
  created_at: string;
}

export type DatabaseType = "POSTGRES" | "MYSQL" | "SQLITE";

/** A database that can be backed up. The `host` field is the DB server address. */
export interface Database {
  id: number;
  name: string;
  db_type: DatabaseType;
  host: string;
  port: number;
  username: string;
  owner: number;
  is_active: boolean;
  created_at: string;
}

/** Backup schedule and retention policy for a database. */
export interface DatabaseConfig {
  id: number;
  database: number;
  backup_frequency_minutes: number;
  retention_days: number;
  /** Weekday numbers (0=Mon … 6=Sun). Empty = every day. */
  backup_days_of_week: number[];
  retention_keep_monthly_first: boolean;
  /** Keep backups from this weekday (0=Mon … 6=Sun). null = no exception. */
  retention_keep_weekly_day: number | null;
  last_backup_at: string | null;
  enabled: boolean;
  created_at: string;
}

/**
 * Policy that causes backups for a DatabaseConfig to be replicated to a
 * StorageHost via SFTP.  Backups are stored locally by default.
 */
export interface ReplicationPolicy {
  id: number;
  database_config: number;
  storage_host: number;
  remote_path: string;
  enabled: boolean;
  /** null = trigger after every successful backup; number = independent interval in minutes */
  replication_frequency_minutes: number | null;
  last_replicated_at: string | null;
  /** null = no separate retention for replicated copies */
  replication_retention_days: number | null;
  created_at: string;
}

export interface BackupReplication {
  id: number;
  storage_host: number;
  remote_path: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  started_at: string | null;
  completed_at: string | null;
  error_message: string;
}

export interface Backup {
  id: number;
  database_config: number;
  file_path: string;
  file_size: number;
  checksum: string;
  started_at: string | null;
  completed_at: string | null;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  error_message: string;
  metadata: Record<string, unknown>;
  replications: BackupReplication[];
}

export interface TriggerBackupResponse {
  status: "backup_accepted";
  database_config: number;
  database: string;
  backup_id: number;
}

export interface TriggerReplicationResponse {
  status: "replication_accepted";
  backup_id: number;
  storage_host_ids: number[];
  count: number;
}

export interface BackupDeletionRequest {
  id: number;
  backup: number;
  requested_by: number;
  delete_replications: boolean;
  status: "PENDING" | "APPROVED" | "DENIED";
  reviewed_by: number | null;
  reviewed_at: string | null;
  admin_note: string;
  created_at: string;
}

export interface LiveBackupsSummary {
  running_backups: number;
  pending_backups: number;
  running_replications: number;
  pending_replications: number;
  failed_replications: number;
  total_items: number;
}

export interface LiveBackupsResponse {
  server_time: string;
  summary: LiveBackupsSummary;
  items: Backup[];
}

export interface RestoreJob {
  id: number;
  backup: number;
  target_db: string;
  triggered_by: number | null;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  started_at: string | null;
  completed_at: string | null;
  error_message: string;
}

export interface RestoreJobsSummary {
  running_restorations: number;
  pending_restorations: number;
  total_items: number;
}

export interface LiveRestorationsResponse {
  server_time: string;
  summary: RestoreJobsSummary;
  items: RestoreJob[];
}

export interface DashboardMetrics {
  largest_databases: Array<{ database_config_id: number; database: string; size: number }>;
  most_backed_up_databases: Array<{ database_config_id: number; "database_config__database__name": string; total: number }>;
  largest_growth: Array<{ database_config_id: number; delta: number }>;
  failure_rate: number;
}

export interface SiteSettings {
  restore_throttle_rate: string;
  manual_backup_throttle_rate: string;
  backup_execution_mode: "python" | "native" | "auto";
}
