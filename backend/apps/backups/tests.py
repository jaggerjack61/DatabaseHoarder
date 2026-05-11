import gzip
import tempfile
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.hosts.models import Database, DatabaseConfig, DatabaseType, StorageHost
from apps.users.models import User

from . import services
from .models import Backup, BackupReplication, BackupStatus, ReplicationStatus
from .views import BackupViewSet


class BackupServiceTests(TestCase):
    def setUp(self):
        self.media_root = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=Path(self.media_root.name))
        self.settings_override.enable()
        self.owner = User.objects.create_user(username="owner", password="password")

    def tearDown(self):
        self.settings_override.disable()
        self.media_root.cleanup()

    def create_config(self, *, db_type=DatabaseType.SQLITE, name="source_db", host="localhost"):
        database = Database(
            name=name,
            db_type=db_type,
            host=host,
            port=3306 if db_type == DatabaseType.MYSQL else 5432,
            username="dbuser",
            owner=self.owner,
        )
        database.set_password("secret")
        database.save()
        return DatabaseConfig.objects.create(database=database)

    def create_storage_host(self):
        storage_host = StorageHost(
            name="storage",
            address="127.0.0.1",
            username="storageuser",
            owner=self.owner,
        )
        storage_host.set_password("secret")
        storage_host.save()
        return storage_host

    def test_execute_backup_failure_marks_existing_backup_failed_and_reraises(self):
        missing_db = Path(self.media_root.name) / "missing.sqlite3"
        config = self.create_config(host=str(missing_db))
        backup = Backup.objects.create(
            database_config=config,
            file_path="",
            status=BackupStatus.PENDING,
        )

        with self.assertRaises(FileNotFoundError):
            services.execute_backup(config.id, backup_id=backup.id)

        backup.refresh_from_db()
        self.assertEqual(backup.status, BackupStatus.FAILED)
        self.assertIn("SQLite database not found", backup.error_message)

    def test_restore_mysql_streams_dump_without_communicating_after_closed_stdin(self):
        config = self.create_config(db_type=DatabaseType.MYSQL)
        backup_path = Path(self.media_root.name) / "backup.sql.gz"
        with gzip.open(backup_path, "wb") as dump_file:
            dump_file.write(b"SELECT 1;")

        processes = []

        class FakeStdin:
            def __init__(self):
                self.closed = False
                self.data = bytearray()

            def write(self, chunk):
                if self.closed:
                    raise AssertionError("write called after stdin was closed")
                self.data.extend(chunk)

            def close(self):
                self.closed = True

        class FakeProcess:
            def __init__(self):
                self.stdin = FakeStdin()
                self.stderr = BytesIO(b"")
                self.returncode = 0
                processes.append(self)

            def wait(self):
                return self.returncode

            def communicate(self):
                if self.stdin.closed:
                    raise AssertionError("communicate called after stdin was closed")
                return None, b""

        with mock.patch.object(
            services.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=0, stderr=""),
        ), mock.patch.object(services.subprocess, "Popen", side_effect=lambda *args, **kwargs: FakeProcess()):
            services._restore_mysql(config, backup_path, "restored_db")

        self.assertEqual(bytes(processes[0].stdin.data), b"SELECT 1;")

    def test_backup_list_does_not_prefetch_storage_hosts_that_are_not_serialized(self):
        config = self.create_config()
        backup = Backup.objects.create(
            database_config=config,
            file_path="backup.db",
            status=BackupStatus.SUCCESS,
        )
        BackupReplication.objects.create(
            backup=backup,
            storage_host=self.create_storage_host(),
            status=ReplicationStatus.SUCCESS,
        )
        request = APIRequestFactory().get("/api/backups/")
        force_authenticate(request, user=self.owner)
        view = BackupViewSet.as_view({"get": "list"})

        with CaptureQueriesContext(connection) as queries:
            response = view(request)
            response.render()

        self.assertEqual(response.status_code, 200)
        captured_sql = "\n".join(query["sql"].lower() for query in queries)
        self.assertNotIn("hosts_storagehost", captured_sql)
