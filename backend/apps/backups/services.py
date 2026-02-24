"""
Backup, restore, and replication services.

Backup strategy:
  - PostgreSQL: pg_dump -Fc  (custom format, compressed)
  - MySQL:      mysqldump --single-transaction --routines --triggers
  - SQLite:     binary copy of the .db file (path supplied as the host field)

Replication:
  - SFTP via paramiko to the configured StorageHost.
  Backups are stored locally by default.  Replication only happens when a
  ReplicationPolicy exists for the DatabaseConfig.

Restore:
  - PostgreSQL: pg_restore
  - MySQL:      mysql < dump
  - SQLite:     file copy back to the target path
"""

import gzip
import hashlib
import os
import shutil
import subprocess
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db.models import Max
from django.utils import timezone

from apps.audit.services import create_audit_log
from apps.hosts.models import DatabaseConfig, DatabaseType

from .models import Backup, BackupReplication, BackupStatus, ReplicationStatus, RestoreJob, RestoreStatus


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_backup_dir(config: DatabaseConfig) -> Path:
    folder = Path(settings.MEDIA_ROOT) / "backups" / str(config.database.owner_id) / str(config.id)
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _backup_filename(config: DatabaseConfig, ext: str) -> Path:
    timestamp = timezone.now().strftime("%Y%m%d_%H%M%S")
    folder = _build_backup_dir(config)
    return folder / f"{config.database.name}_{timestamp}.{ext}"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def get_backup_preflight_error(config: DatabaseConfig) -> str | None:
    """Return a user-friendly prerequisite error message, or None if checks pass."""
    db = config.database

    if db.db_type == DatabaseType.POSTGRES:
        if shutil.which("pg_dump") is None:
            return "pg_dump is not installed or not available in PATH on the worker host."
        return None

    if db.db_type == DatabaseType.MYSQL:
        if shutil.which("mysqldump") is None:
            return "mysqldump is not installed or not available in PATH on the worker host."
        return None

    if db.db_type == DatabaseType.SQLITE:
        source_path = Path(db.host)
        if not source_path.exists():
            return f"SQLite source file does not exist: {source_path}"
        return None

    return f"Unsupported database type: {db.db_type}"


# ---------------------------------------------------------------------------
# Backup implementations
# ---------------------------------------------------------------------------

def _backup_postgres(config: DatabaseConfig) -> Path:
    db = config.database
    out_path = _backup_filename(config, "dump")

    env = {**os.environ, "PGPASSWORD": db.get_password()}
    cmd = [
        "pg_dump",
        "-h", db.host,
        "-p", str(db.port),
        "-U", db.username,
        "-Fc",          # custom format (compressed)
        "-f", str(out_path),
        db.name,
    ]
    result = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"pg_dump failed: {result.stderr.strip()}")
    return out_path


def _backup_mysql(config: DatabaseConfig) -> Path:
    db = config.database
    out_path = _backup_filename(config, "sql.gz")

    env = {**os.environ, "MYSQL_PWD": db.get_password()}
    # Run mysqldump and compress output via Python's built-in gzip (no system gzip needed)
    dump_cmd = [
        "mysqldump",
        f"--host={db.host}",
        f"--port={db.port}",
        f"--user={db.username}",
        "--single-transaction",
        "--routines",
        "--triggers",
        db.name,
    ]
    dump = subprocess.Popen(dump_cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    with gzip.open(out_path, "wb") as gz_file:
        for chunk in iter(lambda: dump.stdout.read(65536), b""):
            gz_file.write(chunk)
    dump.stdout.close()
    dump.wait()

    if dump.returncode != 0:
        stderr = dump.stderr.read().decode(errors="replace")
        raise RuntimeError(f"mysqldump failed: {stderr.strip()}")
    return out_path


def _backup_sqlite(config: DatabaseConfig) -> Path:
    db = config.database
    # For SQLite the 'host' field holds the path to the .db file
    src = Path(db.host)
    if not src.exists():
        raise FileNotFoundError(f"SQLite database not found at: {src}")
    out_path = _backup_filename(config, "db")
    shutil.copy2(src, out_path)
    return out_path


# ---------------------------------------------------------------------------
# Restore implementations
# ---------------------------------------------------------------------------

def _restore_postgres(config: DatabaseConfig, backup_path: Path, target_db: str):
    db = config.database
    env = {**os.environ, "PGPASSWORD": db.get_password()}

    # Create target database if restoring as new
    create_cmd = [
        "psql",
        "-h", db.host,
        "-p", str(db.port),
        "-U", db.username,
        "-c", f'CREATE DATABASE "{target_db}";',
        "postgres",
    ]
    subprocess.run(create_cmd, env=env, capture_output=True)

    restore_cmd = [
        "pg_restore",
        "-h", db.host,
        "-p", str(db.port),
        "-U", db.username,
        "-d", target_db,
        "--no-owner",
        "--no-privileges",
        str(backup_path),
    ]
    result = subprocess.run(restore_cmd, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"pg_restore failed: {result.stderr.strip()}")


def _restore_mysql(config: DatabaseConfig, backup_path: Path, target_db: str):
    db = config.database
    env = {**os.environ, "MYSQL_PWD": db.get_password()}

    create_cmd = [
        "mysql",
        f"--host={db.host}",
        f"--port={db.port}",
        f"--user={db.username}",
        "-e", f"CREATE DATABASE IF NOT EXISTS `{target_db}`;",
    ]
    result = subprocess.run(create_cmd, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"mysql CREATE DATABASE failed: {result.stderr.strip()}")

    restore_cmd = [
        "mysql",
        f"--host={db.host}",
        f"--port={db.port}",
        f"--user={db.username}",
        target_db,
    ]
    # Decompress with Python's built-in gzip (no system gunzip needed)
    with gzip.open(backup_path, "rb") as dump_gz:
        restore = subprocess.Popen(restore_cmd, env=env, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        for chunk in iter(lambda: dump_gz.read(65536), b""):
            restore.stdin.write(chunk)
        restore.stdin.close()
        _, stderr_data = restore.communicate()

    if restore.returncode != 0:
        raise RuntimeError(f"mysql restore failed: {stderr_data.decode(errors='replace').strip()}")


def _restore_sqlite(config: DatabaseConfig, backup_path: Path, target_path: str):
    shutil.copy2(backup_path, target_path)


# ---------------------------------------------------------------------------
# Public: execute backup
# ---------------------------------------------------------------------------

def execute_backup(config_id: int, backup_id: int | None = None):
    config = DatabaseConfig.objects.select_related("database", "database__owner").get(id=config_id)
    db = config.database
    backup = None
    try:
        if backup_id is not None:
            backup = Backup.objects.get(id=backup_id, database_config=config)
            backup.status = BackupStatus.RUNNING
            backup.started_at = timezone.now()
            backup.error_message = ""
            backup.save(update_fields=["status", "started_at", "error_message"])
        else:
            backup = Backup.objects.create(
                database_config=config,
                file_path="",
                status=BackupStatus.RUNNING,
                started_at=timezone.now(),
            )
    except Exception as exc:
        if backup_id is not None:
            # Mark the pre-created PENDING record as failed so it doesn't stay stuck.
            Backup.objects.filter(id=backup_id).update(
                status=BackupStatus.FAILED,
                completed_at=timezone.now(),
                error_message=f"Worker setup failed: {exc}",
            )
        raise

    try:
        if db.db_type == DatabaseType.POSTGRES:
            out_path = _backup_postgres(config)
        elif db.db_type == DatabaseType.MYSQL:
            out_path = _backup_mysql(config)
        elif db.db_type == DatabaseType.SQLITE:
            out_path = _backup_sqlite(config)
        else:
            raise ValueError(f"Unsupported database type: {db.db_type}")

        backup.file_path = str(out_path)
        backup.file_size = out_path.stat().st_size
        backup.checksum = _sha256(out_path)
        backup.status = BackupStatus.SUCCESS
        backup.completed_at = timezone.now()
        backup.metadata = {"db_type": db.db_type, "db_name": db.name}
        backup.save(update_fields=["file_path", "file_size", "checksum", "status", "completed_at", "metadata"])

        config.last_backup_at = backup.completed_at
        config.save(update_fields=["last_backup_at"])

        apply_retention(config)
        create_audit_log(
            user=db.owner,
            action="BACKUP_SUCCESS",
            target=f"DatabaseConfig:{config.id}",
            metadata={"backup_id": backup.id},
        )

        # Trigger replication for all enabled policies
        _trigger_replication(backup)

    except Exception as exc:
        backup.status = BackupStatus.FAILED
        backup.completed_at = timezone.now()
        backup.error_message = str(exc)
        backup.metadata = {"error": str(exc)}
        backup.save(update_fields=["status", "completed_at", "error_message", "metadata"])
        create_audit_log(
            user=db.owner,
            action="BACKUP_FAILED",
            target=f"DatabaseConfig:{config.id}",
            metadata={"error": str(exc), "backup_id": backup.id},
        )


# ---------------------------------------------------------------------------
# Public: execute restore
# ---------------------------------------------------------------------------

def execute_restore(backup_id: int, target_db: str, user):
    """
    Restore a successful backup.

    ``target_db`` is used as:
      - PostgreSQL / MySQL: the target database name
      - SQLite: the target file path
    """
    restore_job = RestoreJob.objects.create(
        backup_id=backup_id,
        target_db=target_db,
        triggered_by=user,
        status=RestoreStatus.RUNNING,
        started_at=timezone.now(),
    )

    backup = Backup.objects.select_related("database_config__database__owner").get(id=backup_id)
    config = backup.database_config
    db = config.database
    backup_path = Path(backup.file_path)

    if not backup_path.exists():
        restore_job.status = RestoreStatus.FAILED
        restore_job.completed_at = timezone.now()
        restore_job.error_message = f"Backup file not found: {backup_path}"
        restore_job.save(update_fields=["status", "completed_at", "error_message"])
        raise FileNotFoundError(f"Backup file not found: {backup_path}")

    try:
        if db.db_type == DatabaseType.POSTGRES:
            _restore_postgres(config, backup_path, target_db)
        elif db.db_type == DatabaseType.MYSQL:
            _restore_mysql(config, backup_path, target_db)
        elif db.db_type == DatabaseType.SQLITE:
            _restore_sqlite(config, backup_path, target_db)
        else:
            raise ValueError(f"Unsupported database type: {db.db_type}")

        restore_job.status = RestoreStatus.SUCCESS
        restore_job.completed_at = timezone.now()
        restore_job.error_message = ""
        restore_job.save(update_fields=["status", "completed_at", "error_message"])

        create_audit_log(
            user=user,
            action="RESTORE_SUCCESS",
            target=f"Backup:{backup.id}",
            metadata={"target_db": target_db},
        )
    except Exception as exc:
        restore_job.status = RestoreStatus.FAILED
        restore_job.completed_at = timezone.now()
        restore_job.error_message = str(exc)
        restore_job.save(update_fields=["status", "completed_at", "error_message"])
        create_audit_log(
            user=user,
            action="RESTORE_FAILED",
            target=f"Backup:{backup.id}",
            metadata={"target_db": target_db, "error": str(exc)},
        )
        raise


# ---------------------------------------------------------------------------
# Public: replication
# ---------------------------------------------------------------------------

def _trigger_replication(backup: Backup):
    """Enqueue replication tasks for enabled policies that use trigger-on-backup (no independent schedule)."""
    from .tasks import run_replication_task  # avoid circular import

    policies = backup.database_config.replication_policies.filter(enabled=True).select_related("storage_host")
    for policy in policies:
        # Skip policies with an independent schedule — handled by schedule_due_replications
        if policy.replication_frequency_minutes is not None:
            continue
        run_replication_task.delay(backup.id, policy.storage_host_id, policy.remote_path)


def execute_replication(backup_id: int, storage_host_id: int, remote_dir: str):
    """
    Copy a local backup file to a StorageHost via SFTP.
    Creates a BackupReplication record to track the status.
    """
    import paramiko  # optional dependency — import lazily

    from apps.hosts.models import StorageHost

    backup = Backup.objects.select_related("database_config__database__owner").get(id=backup_id)
    storage_host = StorageHost.objects.get(id=storage_host_id)
    owner = backup.database_config.database.owner

    replication, _ = BackupReplication.objects.get_or_create(
        backup=backup,
        storage_host=storage_host,
        defaults={"status": ReplicationStatus.PENDING, "remote_path": ""},
    )
    replication.status = ReplicationStatus.RUNNING
    replication.started_at = timezone.now()
    replication.save(update_fields=["status", "started_at"])

    local_path = Path(backup.file_path)
    filename = local_path.name
    remote_path = remote_dir.rstrip("/") + "/" + filename

    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=storage_host.address,
            port=storage_host.ssh_port,
            username=storage_host.username,
            password=storage_host.get_password(),
            timeout=30,
        )
        # Ensure remote directory exists
        stdin, stdout, stderr = client.exec_command(f"mkdir -p {remote_dir}")
        stdout.channel.recv_exit_status()

        sftp = client.open_sftp()
        sftp.put(str(local_path), remote_path)
        sftp.close()
        client.close()

        replication.status = ReplicationStatus.SUCCESS
        replication.remote_path = remote_path
        replication.completed_at = timezone.now()
        replication.error_message = ""
        replication.save(update_fields=["status", "remote_path", "completed_at", "error_message"])

        create_audit_log(
            user=owner,
            action="REPLICATION_SUCCESS",
            target=f"Backup:{backup.id}",
            metadata={"storage_host_id": storage_host.id, "remote_path": remote_path},
        )
    except Exception as exc:
        replication.status = ReplicationStatus.FAILED
        replication.completed_at = timezone.now()
        replication.error_message = str(exc)
        replication.save(update_fields=["status", "completed_at", "error_message"])
        create_audit_log(
            user=owner,
            action="REPLICATION_FAILED",
            target=f"Backup:{backup.id}",
            metadata={"storage_host_id": storage_host.id, "error": str(exc)},
        )
        raise


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------

def apply_retention(config: DatabaseConfig):
    cutoff = timezone.now() - timedelta(days=config.retention_days)
    queryset = Backup.objects.filter(database_config=config, status=BackupStatus.SUCCESS).order_by("-completed_at")
    latest_success = queryset.first()
    stale = queryset.filter(completed_at__lt=cutoff)

    for backup in stale:
        if latest_success and backup.id == latest_success.id:
            continue
        # Exception: keep backups completed on the 1st of any month
        if config.retention_keep_monthly_first and backup.completed_at and backup.completed_at.day == 1:
            continue
        # Exception: keep backups completed on a specific weekday
        if (
            config.retention_keep_weekly_day is not None
            and backup.completed_at
            and backup.completed_at.weekday() == config.retention_keep_weekly_day
        ):
            continue
        path = Path(backup.file_path)
        if path.exists():
            path.unlink()
        create_audit_log(
            user=config.database.owner,
            action="BACKUP_DELETED_RETENTION",
            target=f"Backup:{backup.id}",
            metadata={"database_config_id": config.id},
        )
        backup.delete()


def apply_replication_retention(policy):
    """Delete BackupReplication records older than policy.replication_retention_days."""
    if not policy.replication_retention_days:
        return
    cutoff = timezone.now() - timedelta(days=policy.replication_retention_days)
    stale = BackupReplication.objects.filter(
        storage_host=policy.storage_host,
        backup__database_config=policy.database_config,
        status=ReplicationStatus.SUCCESS,
        completed_at__lt=cutoff,
    )
    for rep in stale:
        create_audit_log(
            user=policy.database_config.database.owner,
            action="REPLICATION_DELETED_RETENTION",
            target=f"BackupReplication:{rep.id}",
            metadata={"policy_id": policy.id},
        )
        rep.delete()


# ---------------------------------------------------------------------------
# Dashboard helper
# ---------------------------------------------------------------------------

def get_largest_databases():
    latest_ids = (
        Backup.objects.filter(status=BackupStatus.SUCCESS)
        .values("database_config_id")
        .annotate(last_id=Max("id"))
        .values_list("last_id", flat=True)
    )
    return (
        Backup.objects.filter(id__in=latest_ids)
        .select_related("database_config__database")
        .order_by("-file_size")[:10]
    )
