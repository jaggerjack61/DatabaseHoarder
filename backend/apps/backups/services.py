"""
Backup, restore, and replication services.

Backup strategy:
    - PostgreSQL/MySQL: Python-native logical dump (default) or native CLI tools
        (`pg_dump`/`mysqldump`) depending on BACKUP_EXECUTION_MODE.
  - SQLite:     binary copy of the .db file (path supplied as the host field)

Replication:
  - SFTP via paramiko to the configured StorageHost.
  Backups are stored locally by default.  Replication only happens when a
  ReplicationPolicy exists for the DatabaseConfig.

Restore:
    - PostgreSQL/MySQL: Python-native restore for `.json.gz` logical dumps,
        native tools for legacy `.dump`/`.sql.gz` backups.
  - SQLite:     file copy back to the target path
"""

import gzip
import hashlib
import json
import os
import shutil
import subprocess
from base64 import b64decode, b64encode
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path

import psycopg
import pymysql

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


def _backup_mode() -> str:
    mode = None
    try:
        from apps.common.models import SiteSettings

        mode = SiteSettings.get().backup_execution_mode
    except Exception:
        mode = str(getattr(settings, "BACKUP_EXECUTION_MODE", "auto"))

    mode = str(mode).lower().strip()
    if mode not in {"python", "native", "auto"}:
        return "auto"
    return mode


def _use_native_tool(binary_name: str) -> bool:
    mode = _backup_mode()
    if mode == "python":
        return False
    if mode == "native":
        return True
    return shutil.which(binary_name) is not None


def _sqlite_path_for_db(db) -> str:
    return db.sqlite_path or db.host


def _check_remote_sqlite_source(db):
    import paramiko

    if not db.host:
        raise ValueError("SSH host is required for remote SQLite databases.")
    if not db.port:
        raise ValueError("SSH port is required for remote SQLite databases.")
    if not db.username:
        raise ValueError("SSH username is required for remote SQLite databases.")
    path = _sqlite_path_for_db(db)
    if not path:
        raise ValueError("SQLite path is required for remote SQLite databases.")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=db.host,
        port=db.port,
        username=db.username,
        password=db.get_password(),
        timeout=10,
        allow_agent=False,
        look_for_keys=False,
    )
    sftp = client.open_sftp()
    try:
        sftp.stat(path)
    except FileNotFoundError:
        raise FileNotFoundError(f"SSH connection successful, but SQLite file not found at: {path}")
    except OSError as exc:
        if getattr(exc, "errno", None) == 2:
            raise FileNotFoundError(f"SSH connection successful, but SQLite file not found at: {path}")
        raise
    finally:
        sftp.close()
        client.close()


def get_backup_preflight_error(config: DatabaseConfig) -> str | None:
    """Return a user-friendly prerequisite error message, or None if checks pass."""
    db = config.database

    if db.db_type == DatabaseType.POSTGRES:
        if _use_native_tool("pg_dump") and shutil.which("pg_dump") is None:
            return "pg_dump is not installed or not available in PATH on the worker host."
        return None

    if db.db_type == DatabaseType.MYSQL:
        if _use_native_tool("mysqldump") and shutil.which("mysqldump") is None:
            return "mysqldump is not installed or not available in PATH on the worker host."
        return None

    if db.db_type == DatabaseType.SQLITE:
        if db.sqlite_location == "REMOTE":
            try:
                _check_remote_sqlite_source(db)
            except Exception as exc:
                return str(exc)
            return None
        source_path = Path(_sqlite_path_for_db(db))
        if not source_path.exists():
            return f"SQLite source file does not exist: {source_path}"
        return None

    return f"Unsupported database type: {db.db_type}"


# ---------------------------------------------------------------------------
# Backup implementations
# ---------------------------------------------------------------------------

def _serialize_value(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Decimal):
        return {"__type": "decimal", "value": str(value)}
    if isinstance(value, datetime):
        return {"__type": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"__type": "date", "value": value.isoformat()}
    if isinstance(value, time):
        return {"__type": "time", "value": value.isoformat()}
    if isinstance(value, (bytes, bytearray)):
        return {"__type": "bytes", "value": b64encode(bytes(value)).decode("ascii")}
    return {"__type": "string", "value": str(value)}


def _deserialize_value(value):
    if not isinstance(value, dict) or "__type" not in value:
        return value
    value_type = value["__type"]
    raw = value.get("value")
    if value_type == "decimal":
        return Decimal(raw)
    if value_type == "datetime":
        return datetime.fromisoformat(raw)
    if value_type == "date":
        return date.fromisoformat(raw)
    if value_type == "time":
        return time.fromisoformat(raw)
    if value_type == "bytes":
        return b64decode(raw)
    return str(raw)


def _backup_postgres_python(config: DatabaseConfig) -> Path:
    db = config.database
    out_path = _backup_filename(config, "json.gz")

    tables = []
    with psycopg.connect(
        host=db.host,
        port=db.port,
        user=db.username,
        password=db.get_password(),
        dbname=db.name,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT n.nspname AS schema_name, c.relname AS table_name
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind = 'r'
                  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY n.nspname, c.relname
                """
            )
            table_rows = cur.fetchall()

        for schema_name, table_name in table_rows:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        a.attname AS column_name,
                        pg_catalog.format_type(a.atttypid, a.atttypmod) AS column_type,
                        a.attnotnull AS not_null,
                        pg_get_expr(ad.adbin, ad.adrelid) AS column_default
                    FROM pg_attribute a
                    JOIN pg_class c ON a.attrelid = c.oid
                    JOIN pg_namespace n ON c.relnamespace = n.oid
                    LEFT JOIN pg_attrdef ad ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
                    WHERE n.nspname = %s
                      AND c.relname = %s
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                    ORDER BY a.attnum
                    """,
                    (schema_name, table_name),
                )
                columns = [
                    {
                        "name": column_name,
                        "column_type": column_type,
                        "not_null": bool(not_null),
                        "column_default": column_default,
                    }
                    for (column_name, column_type, not_null, column_default) in cur.fetchall()
                ]

                quoted_schema = schema_name.replace('"', '""')
                quoted_table = table_name.replace('"', '""')
                cur.execute(f'SELECT * FROM "{quoted_schema}"."{quoted_table}"')
                rows = [
                    [_serialize_value(value) for value in row]
                    for row in cur.fetchall()
                ]

            tables.append(
                {
                    "schema": schema_name,
                    "name": table_name,
                    "columns": columns,
                    "rows": rows,
                }
            )

    payload = {
        "format": "dbauto-python-logical-v1",
        "db_type": DatabaseType.POSTGRES,
        "database": db.name,
        "tables": tables,
    }
    with gzip.open(out_path, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    return out_path


def _backup_mysql_python(config: DatabaseConfig) -> Path:
    db = config.database
    out_path = _backup_filename(config, "json.gz")

    tables = []
    conn = pymysql.connect(
        host=db.host,
        port=db.port,
        user=db.username,
        password=db.get_password(),
        database=db.name,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.Cursor,
        autocommit=True,
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = %s
                  AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """,
                (db.name,),
            )
            table_rows = cur.fetchall()

        for (table_name,) in table_rows:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT column_name, column_type, is_nullable, column_default, extra
                    FROM information_schema.columns
                    WHERE table_schema = %s AND table_name = %s
                    ORDER BY ordinal_position
                    """,
                    (db.name, table_name),
                )
                columns = [
                    {
                        "name": column_name,
                        "column_type": column_type,
                        "not_null": is_nullable == "NO",
                        "column_default": column_default,
                        "extra": extra,
                    }
                    for (column_name, column_type, is_nullable, column_default, extra) in cur.fetchall()
                ]

                quoted_table = table_name.replace("`", "``")
                cur.execute(f"SELECT * FROM `{quoted_table}`")
                rows = [
                    [_serialize_value(value) for value in row]
                    for row in cur.fetchall()
                ]

            tables.append({"name": table_name, "columns": columns, "rows": rows})

    finally:
        conn.close()

    payload = {
        "format": "dbauto-python-logical-v1",
        "db_type": DatabaseType.MYSQL,
        "database": db.name,
        "tables": tables,
    }
    with gzip.open(out_path, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    return out_path

def _backup_postgres(config: DatabaseConfig) -> Path:
    if not _use_native_tool("pg_dump"):
        return _backup_postgres_python(config)

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
    if not _use_native_tool("mysqldump"):
        return _backup_mysql_python(config)

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
    out_path = _backup_filename(config, "db")
    if db.sqlite_location == "REMOTE":
        import paramiko

        path = _sqlite_path_for_db(db)
        if not path:
            raise FileNotFoundError("SQLite path is required for remote SQLite backups.")
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=db.host,
            port=db.port,
            username=db.username,
            password=db.get_password(),
            timeout=30,
            allow_agent=False,
            look_for_keys=False,
        )
        sftp = client.open_sftp()
        try:
            sftp.get(path, str(out_path))
        except FileNotFoundError:
            raise FileNotFoundError(f"SSH connection successful, but SQLite file not found at: {path}")
        except OSError as exc:
            if getattr(exc, "errno", None) == 2:
                raise FileNotFoundError(f"SSH connection successful, but SQLite file not found at: {path}")
            raise
        finally:
            sftp.close()
            client.close()
    else:
        src = Path(_sqlite_path_for_db(db))
        if not src.exists():
            raise FileNotFoundError(f"SQLite database not found at: {src}")
        shutil.copy2(src, out_path)
    return out_path


# ---------------------------------------------------------------------------
# Restore implementations
# ---------------------------------------------------------------------------

def _restore_postgres(config: DatabaseConfig, backup_path: Path, target_db: str):
    if backup_path.suffixes[-2:] == [".json", ".gz"]:
        return _restore_postgres_python(config, backup_path, target_db)

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
    if backup_path.suffixes[-2:] == [".json", ".gz"]:
        return _restore_mysql_python(config, backup_path, target_db)

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


def _restore_postgres_python(config: DatabaseConfig, backup_path: Path, target_db: str):
    db = config.database
    with gzip.open(backup_path, "rt", encoding="utf-8") as fh:
        payload = json.load(fh)

    if payload.get("db_type") != DatabaseType.POSTGRES:
        raise RuntimeError("Backup format/database mismatch for PostgreSQL restore.")

    with psycopg.connect(
        host=db.host,
        port=db.port,
        user=db.username,
        password=db.get_password(),
        dbname="postgres",
        autocommit=True,
    ) as admin_conn:
        with admin_conn.cursor() as cur:
            quoted_target = target_db.replace('"', '""')
            cur.execute(f'SELECT 1 FROM pg_database WHERE datname = %s', (target_db,))
            exists = cur.fetchone() is not None
            if not exists:
                cur.execute(f'CREATE DATABASE "{quoted_target}"')

    with psycopg.connect(
        host=db.host,
        port=db.port,
        user=db.username,
        password=db.get_password(),
        dbname=target_db,
    ) as conn:
        with conn.cursor() as cur:
            for table in payload.get("tables", []):
                schema_name = table["schema"]
                table_name = table["name"]
                columns = table.get("columns", [])

                quoted_schema = schema_name.replace('"', '""')
                quoted_table = table_name.replace('"', '""')
                cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{quoted_schema}"')
                cur.execute(f'DROP TABLE IF EXISTS "{quoted_schema}"."{quoted_table}" CASCADE')

                column_defs = []
                for column in columns:
                    quoted_col = column["name"].replace('"', '""')
                    pieces = [f'"{quoted_col}"', column["column_type"]]
                    if column.get("not_null"):
                        pieces.append("NOT NULL")
                    if column.get("column_default") is not None:
                        pieces.append(f"DEFAULT {column['column_default']}")
                    column_defs.append(" ".join(pieces))

                create_sql = f'CREATE TABLE "{quoted_schema}"."{quoted_table}" ({", ".join(column_defs)})'
                cur.execute(create_sql)

                rows = table.get("rows", [])
                if rows:
                    quoted_cols = ", ".join(f'"{column["name"].replace("\"", "\"\"")}"' for column in columns)
                    placeholders = ", ".join(["%s"] * len(columns))
                    insert_sql = f'INSERT INTO "{quoted_schema}"."{quoted_table}" ({quoted_cols}) VALUES ({placeholders})'
                    converted_rows = [tuple(_deserialize_value(value) for value in row) for row in rows]
                    cur.executemany(insert_sql, converted_rows)
        conn.commit()


def _restore_mysql_python(config: DatabaseConfig, backup_path: Path, target_db: str):
    db = config.database
    with gzip.open(backup_path, "rt", encoding="utf-8") as fh:
        payload = json.load(fh)

    if payload.get("db_type") != DatabaseType.MYSQL:
        raise RuntimeError("Backup format/database mismatch for MySQL restore.")

    admin_conn = pymysql.connect(
        host=db.host,
        port=db.port,
        user=db.username,
        password=db.get_password(),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.Cursor,
        autocommit=True,
    )
    try:
        with admin_conn.cursor() as cur:
            quoted_target = target_db.replace("`", "``")
            cur.execute(f"CREATE DATABASE IF NOT EXISTS `{quoted_target}`")
    finally:
        admin_conn.close()

    conn = pymysql.connect(
        host=db.host,
        port=db.port,
        user=db.username,
        password=db.get_password(),
        database=target_db,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.Cursor,
        autocommit=False,
    )
    try:
        with conn.cursor() as cur:
            for table in payload.get("tables", []):
                table_name = table["name"]
                columns = table.get("columns", [])

                quoted_table = table_name.replace("`", "``")
                cur.execute(f"DROP TABLE IF EXISTS `{quoted_table}`")

                column_defs = []
                for column in columns:
                    quoted_col = column["name"].replace("`", "``")
                    pieces = [f"`{quoted_col}`", column["column_type"]]
                    if column.get("not_null"):
                        pieces.append("NOT NULL")
                    else:
                        pieces.append("NULL")
                    if column.get("extra"):
                        pieces.append(column["extra"])
                    column_defs.append(" ".join(pieces))

                create_sql = f"CREATE TABLE `{quoted_table}` ({', '.join(column_defs)})"
                cur.execute(create_sql)

                rows = table.get("rows", [])
                if rows:
                    quoted_cols = ", ".join(f"`{column['name'].replace('`', '``')}`" for column in columns)
                    placeholders = ", ".join(["%s"] * len(columns))
                    insert_sql = f"INSERT INTO `{quoted_table}` ({quoted_cols}) VALUES ({placeholders})"
                    converted_rows = [tuple(_deserialize_value(value) for value in row) for row in rows]
                    cur.executemany(insert_sql, converted_rows)
        conn.commit()
    finally:
        conn.close()


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
        backup.metadata = {
            "db_type": db.db_type,
            "db_name": db.name,
            "backup_engine": "native" if out_path.suffix in {".dump", ".gz"} and ".json" not in "".join(out_path.suffixes) else "python",
            "backup_mode": _backup_mode(),
        }
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


def delete_backup_artifacts(backup: Backup, delete_replications: bool = False):
    """
    Delete local backup file and optionally attempt deletion of replicated remote files.
    Remote cleanup failures are ignored so backup deletion can still proceed.
    """
    local_path = Path(backup.file_path)
    if local_path.exists() and str(local_path).startswith(str(settings.MEDIA_ROOT)):
        local_path.unlink()

    if not delete_replications:
        return

    try:
        import paramiko
    except Exception:
        return

    replications = backup.replications.select_related("storage_host").all()
    for replication in replications:
        if not replication.remote_path:
            continue
        try:
            host = replication.storage_host
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(
                hostname=host.address,
                port=host.ssh_port,
                username=host.username,
                password=host.get_password(),
                timeout=30,
            )
            sftp = client.open_sftp()
            sftp.remove(replication.remote_path)
            sftp.close()
            client.close()
        except Exception:
            continue


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------

def apply_retention(config: DatabaseConfig):
    now = timezone.now()
    cutoff = now - timedelta(days=config.retention_days)
    queryset = Backup.objects.filter(database_config=config, status=BackupStatus.SUCCESS).order_by("-completed_at")
    latest_success = queryset.first()
    stale = queryset.filter(completed_at__lt=cutoff)
    exception_keep_ids = set()
    if config.retention_exception_days:
        last_kept_at = None
        max_cutoff = (
            now - timedelta(days=config.retention_exception_max_days)
            if config.retention_exception_max_days
            else None
        )
        for backup in stale:
            if not backup.completed_at:
                continue
            if max_cutoff and backup.completed_at < max_cutoff:
                continue
            if last_kept_at is None:
                exception_keep_ids.add(backup.id)
                last_kept_at = backup.completed_at
                continue
            if (last_kept_at - backup.completed_at).days >= config.retention_exception_days:
                exception_keep_ids.add(backup.id)
                last_kept_at = backup.completed_at

    for backup in stale:
        if latest_success and backup.id == latest_success.id:
            continue
        if backup.id in exception_keep_ids:
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
    now = timezone.now()
    cutoff = now - timedelta(days=policy.replication_retention_days)
    stale = BackupReplication.objects.filter(
        storage_host=policy.storage_host,
        backup__database_config=policy.database_config,
        status=ReplicationStatus.SUCCESS,
        completed_at__lt=cutoff,
    ).order_by("-completed_at")
    exception_keep_ids = set()
    if policy.replication_retention_exception_days:
        last_kept_at = None
        max_cutoff = (
            now - timedelta(days=policy.replication_retention_exception_max_days)
            if policy.replication_retention_exception_max_days
            else None
        )
        for rep in stale:
            if not rep.completed_at:
                continue
            if max_cutoff and rep.completed_at < max_cutoff:
                continue
            if last_kept_at is None:
                exception_keep_ids.add(rep.id)
                last_kept_at = rep.completed_at
                continue
            if (last_kept_at - rep.completed_at).days >= policy.replication_retention_exception_days:
                exception_keep_ids.add(rep.id)
                last_kept_at = rep.completed_at
    for rep in stale:
        if rep.id in exception_keep_ids:
            continue
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
