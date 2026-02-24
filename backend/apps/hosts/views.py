from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.serializers import CharField, ChoiceField, IntegerField, Serializer
from rest_framework.views import APIView

from apps.common.crypto import decrypt_text
from apps.common.models import SiteSettings

from .access import accessible_configs_for_user, accessible_databases_for_user, accessible_storage_hosts_for_user
from .models import Database, DatabaseConfig, ReplicationPolicy, StorageHost
from .serializers import (
    DatabaseConfigSerializer,
    DatabaseSerializer,
    ReplicationPolicySerializer,
    StorageHostSerializer,
)


class StorageHostConnectionTestSerializer(Serializer):
    address = CharField(max_length=255)
    ssh_port = IntegerField(min_value=1, max_value=65535)
    username = CharField(max_length=120)
    password = CharField(required=False, allow_blank=True, default="")


class DatabaseConnectionTestSerializer(Serializer):
    db_type = ChoiceField(choices=("POSTGRES", "MYSQL", "SQLITE"))
    host = CharField(max_length=255, required=False, allow_blank=True, default="")
    port = IntegerField(min_value=1, max_value=65535, required=False)
    username = CharField(max_length=120, required=False, allow_blank=True, default="")
    password = CharField(required=False, allow_blank=True, default="")
    sqlite_location = ChoiceField(choices=("LOCAL", "REMOTE"), required=False, default="LOCAL")
    sqlite_path = CharField(max_length=500, required=False, allow_blank=True, default="")


def test_storage_host_connection(address: str, ssh_port: int, username: str, password: str):
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        address,
        port=ssh_port,
        username=username,
        password=password,
        timeout=10,
        allow_agent=False,
        look_for_keys=False,
    )
    client.close()


def test_database_connection(
    db_type: str,
    host: str,
    port: int | None,
    username: str,
    password: str,
    sqlite_location: str = "LOCAL",
    sqlite_path: str = "",
):
    if db_type == "POSTGRES":
        import psycopg

        conn = psycopg.connect(
            host=host,
            port=port,
            user=username,
            password=password,
            dbname="postgres",
            connect_timeout=10,
        )
        conn.close()
    elif db_type == "MYSQL":
        import pymysql

        conn = pymysql.connect(
            host=host,
            port=port,
            user=username,
            password=password,
            connect_timeout=10,
        )
        conn.close()
    elif db_type == "SQLITE":
        from pathlib import Path

        if sqlite_location == "REMOTE":
            if not host:
                raise ValueError("SSH host is required for remote SQLite databases.")
            if not port:
                raise ValueError("SSH port is required for remote SQLite databases.")
            if not username:
                raise ValueError("SSH username is required for remote SQLite databases.")
            if not sqlite_path:
                raise ValueError("SQLite path is required for remote SQLite databases.")
            import paramiko

            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(
                host,
                port=port,
                username=username,
                password=password,
                timeout=10,
                allow_agent=False,
                look_for_keys=False,
            )
            sftp = client.open_sftp()
            try:
                sftp.stat(sqlite_path)
            except FileNotFoundError:
                raise FileNotFoundError(f"SSH connection successful, but SQLite file not found at: {sqlite_path}")
            except OSError as exc:
                if getattr(exc, "errno", None) == 2:
                    raise FileNotFoundError(f"SSH connection successful, but SQLite file not found at: {sqlite_path}")
                raise
            finally:
                sftp.close()
                client.close()
        else:
            path = sqlite_path or host
            if not path:
                raise ValueError("SQLite path is required for local SQLite databases.")
            source_path = Path(path)
            if not source_path.exists():
                raise FileNotFoundError(f"SQLite file not found at: {source_path}")
    else:
        raise ValueError(f"Unsupported db_type: {db_type}")


class OwnerFilteredQuerysetMixin:
    """Filter list results to the requesting user unless they are an admin."""

    owner_lookup = "owner"

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.is_admin:
            return queryset
        if queryset.model is StorageHost:
            return queryset.filter(id__in=accessible_storage_hosts_for_user(user).values_list("id", flat=True))
        if queryset.model is Database:
            return queryset.filter(id__in=accessible_databases_for_user(user).values_list("id", flat=True))
        if queryset.model is DatabaseConfig:
            return queryset.filter(id__in=accessible_configs_for_user(user).values_list("id", flat=True))
        return queryset.filter(**{self.owner_lookup: user})


class StorageHostViewSet(OwnerFilteredQuerysetMixin, viewsets.ModelViewSet):
    """CRUD for SSH storage hosts used to store replicated backup files."""

    queryset = StorageHost.objects.select_related("owner").all()
    serializer_class = StorageHostSerializer
    permission_classes = (IsAuthenticated,)

    @action(detail=False, methods=["post"], url_path="test-connection")
    def test_connection_with_payload(self, request):
        """Attempt an SSH connection using payload details (for create/edit forms)."""
        serializer = StorageHostConnectionTestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            test_storage_host_connection(
                address=data["address"],
                ssh_port=data["ssh_port"],
                username=data["username"],
                password=data.get("password", ""),
            )
            return Response({"success": True, "message": "SSH connection successful."})
        except Exception as exc:
            return Response({"success": False, "message": str(exc)})

    @action(detail=True, methods=["post"], url_path="test-connection")
    def test_connection(self, request, pk=None):
        """Attempt an SSH connection and return success/failure."""
        host = self.get_object()
        try:
            password = decrypt_text(host.encrypted_password) if host.encrypted_password else ""
            test_storage_host_connection(
                address=host.address,
                ssh_port=host.ssh_port,
                username=host.username,
                password=password,
            )
            return Response({"success": True, "message": "SSH connection successful."})
        except Exception as exc:
            return Response({"success": False, "message": str(exc)})


class DatabaseViewSet(OwnerFilteredQuerysetMixin, viewsets.ModelViewSet):
    """CRUD for databases that need to be backed up."""

    queryset = Database.objects.select_related("owner").all()
    serializer_class = DatabaseSerializer
    permission_classes = (IsAuthenticated,)

    @action(detail=False, methods=["post"], url_path="test-connection")
    def test_connection_with_payload(self, request):
        """Attempt a database connection using payload details (for create/edit forms)."""
        serializer = DatabaseConnectionTestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            test_database_connection(
                db_type=data["db_type"],
                host=data["host"],
                port=data.get("port"),
                username=data.get("username", ""),
                password=data.get("password", ""),
                sqlite_location=data.get("sqlite_location", "LOCAL"),
                sqlite_path=data.get("sqlite_path", ""),
            )
            return Response({"success": True, "message": "Database connection successful."})
        except Exception as exc:
            return Response({"success": False, "message": str(exc)})

    @action(detail=True, methods=["post"], url_path="test-connection")
    def test_connection(self, request, pk=None):
        """Attempt a database connection and return success/failure."""
        db = self.get_object()
        try:
            password = decrypt_text(db.encrypted_password) if db.encrypted_password else ""
            test_database_connection(
                db_type=db.db_type,
                host=db.host,
                port=db.port,
                username=db.username,
                password=password,
                sqlite_location=db.sqlite_location,
                sqlite_path=db.sqlite_path,
            )
            return Response({"success": True, "message": "Database connection successful."})
        except Exception as exc:
            return Response({"success": False, "message": str(exc)})


class ConnectionStatusView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        user = request.user
        settings = SiteSettings.get()
        force = (request.query_params.get("force", "").strip().lower() in {"1", "true", "yes"})
        now = timezone.now()
        interval_seconds = max(1, settings.connection_check_interval_seconds)
        last_check = settings.last_connection_check_at
        cached_payload = settings.last_connection_check_payload or {}
        if not force and last_check and (now - last_check).total_seconds() < interval_seconds and cached_payload:
            return Response(
                {
                    "checked_at": cached_payload.get("checked_at"),
                    "poll_interval_seconds": interval_seconds,
                    "storage_hosts": cached_payload.get("storage_hosts", []),
                    "databases": cached_payload.get("databases", []),
                }
            )
        if user.is_admin:
            storage_hosts = StorageHost.objects.all()
            databases = Database.objects.all()
        else:
            storage_hosts = accessible_storage_hosts_for_user(user)
            databases = accessible_databases_for_user(user)

        storage_rows = []
        for host in storage_hosts:
            if not host.is_active:
                storage_rows.append(
                    {
                        "id": host.id,
                        "name": host.name,
                        "address": host.address,
                        "ssh_port": host.ssh_port,
                        "username": host.username,
                        "is_active": host.is_active,
                        "success": False,
                        "message": "Inactive",
                    }
                )
                continue
            try:
                password = decrypt_text(host.encrypted_password) if host.encrypted_password else ""
                test_storage_host_connection(
                    address=host.address,
                    ssh_port=host.ssh_port,
                    username=host.username,
                    password=password,
                )
                storage_rows.append(
                    {
                        "id": host.id,
                        "name": host.name,
                        "address": host.address,
                        "ssh_port": host.ssh_port,
                        "username": host.username,
                        "is_active": host.is_active,
                        "success": True,
                        "message": "SSH connection successful.",
                    }
                )
            except Exception as exc:
                storage_rows.append(
                    {
                        "id": host.id,
                        "name": host.name,
                        "address": host.address,
                        "ssh_port": host.ssh_port,
                        "username": host.username,
                        "is_active": host.is_active,
                        "success": False,
                        "message": str(exc),
                    }
                )

        database_rows = []
        for db in databases:
            if not db.is_active:
                database_rows.append(
                    {
                        "id": db.id,
                        "name": db.name,
                        "alias": db.alias,
                        "db_type": db.db_type,
                        "host": db.host,
                        "port": db.port,
                        "username": db.username,
                        "sqlite_location": db.sqlite_location,
                        "sqlite_path": db.sqlite_path,
                        "is_active": db.is_active,
                        "success": False,
                        "message": "Inactive",
                    }
                )
                continue
            try:
                password = decrypt_text(db.encrypted_password) if db.encrypted_password else ""
                test_database_connection(
                    db_type=db.db_type,
                    host=db.host,
                    port=db.port,
                    username=db.username,
                    password=password,
                    sqlite_location=db.sqlite_location,
                    sqlite_path=db.sqlite_path,
                )
                database_rows.append(
                    {
                        "id": db.id,
                        "name": db.name,
                        "alias": db.alias,
                        "db_type": db.db_type,
                        "host": db.host,
                        "port": db.port,
                        "username": db.username,
                        "sqlite_location": db.sqlite_location,
                        "sqlite_path": db.sqlite_path,
                        "is_active": db.is_active,
                        "success": True,
                        "message": "Database connection successful.",
                    }
                )
            except Exception as exc:
                database_rows.append(
                    {
                        "id": db.id,
                        "name": db.name,
                        "alias": db.alias,
                        "db_type": db.db_type,
                        "host": db.host,
                        "port": db.port,
                        "username": db.username,
                        "sqlite_location": db.sqlite_location,
                        "sqlite_path": db.sqlite_path,
                        "is_active": db.is_active,
                        "success": False,
                        "message": str(exc),
                    }
                )

        checked_at = now.isoformat()
        payload = {
            "checked_at": checked_at,
            "storage_hosts": storage_rows,
            "databases": database_rows,
        }
        settings.last_connection_check_at = now
        settings.last_connection_check_payload = payload
        settings.save(update_fields=["last_connection_check_at", "last_connection_check_payload"])

        return Response(
            {
                "checked_at": checked_at,
                "poll_interval_seconds": interval_seconds,
                "storage_hosts": storage_rows,
                "databases": database_rows,
            }
        )


class DatabaseConfigViewSet(OwnerFilteredQuerysetMixin, viewsets.ModelViewSet):
    """CRUD for backup schedule configurations."""

    queryset = DatabaseConfig.objects.select_related("database", "database__owner").all()
    serializer_class = DatabaseConfigSerializer
    permission_classes = (IsAuthenticated,)
    owner_lookup = "database__owner"


class ReplicationPolicyViewSet(OwnerFilteredQuerysetMixin, viewsets.ModelViewSet):
    """CRUD for replication policies (which backups to copy to which storage hosts)."""

    queryset = ReplicationPolicy.objects.select_related(
        "database_config__database__owner",
        "storage_host",
    ).all()
    serializer_class = ReplicationPolicySerializer
    permission_classes = (IsAuthenticated,)
    owner_lookup = "database_config__database__owner"

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.is_admin:
            return queryset
        accessible_config_ids = accessible_configs_for_user(user).values_list("id", flat=True)
        accessible_host_ids = accessible_storage_hosts_for_user(user).values_list("id", flat=True)
        return queryset.filter(database_config_id__in=accessible_config_ids, storage_host_id__in=accessible_host_ids)
