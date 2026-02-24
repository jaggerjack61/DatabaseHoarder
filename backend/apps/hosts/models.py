from django.conf import settings
from django.db import models

from apps.common.crypto import decrypt_text, encrypt_text


class StorageHost(models.Model):
    """
    An SSH-accessible server used to store replicated database backup files.
    Completely independent of which databases exist on it.
    """

    name = models.CharField(max_length=120)
    address = models.CharField(max_length=255, help_text="IP address or hostname of the SSH server")
    ssh_port = models.PositiveIntegerField(default=22)
    username = models.CharField(max_length=120)
    encrypted_password = models.TextField()
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="storage_hosts")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)

    def set_password(self, raw_password: str):
        self.encrypted_password = encrypt_text(raw_password)

    def get_password(self) -> str:
        return decrypt_text(self.encrypted_password)

    def __str__(self):
        return f"{self.name} ({self.address})"


class DatabaseType(models.TextChoices):
    POSTGRES = "POSTGRES", "PostgreSQL"
    MYSQL = "MYSQL", "MySQL"
    SQLITE = "SQLITE", "SQLite"


class Database(models.Model):
    """
    A database that can be backed up.
    The ``host`` field is the database server address and is entirely
    unrelated to ``StorageHost``.
    """

    name = models.CharField(max_length=120, help_text="Friendly label for this database")
    db_type = models.CharField(max_length=16, choices=DatabaseType.choices)
    host = models.CharField(max_length=255, help_text="Hostname / IP of the database server")
    port = models.PositiveIntegerField(default=5432)
    username = models.CharField(max_length=120)
    encrypted_password = models.TextField()
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="databases")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)

    def set_password(self, raw_password: str):
        self.encrypted_password = encrypt_text(raw_password)

    def get_password(self) -> str:
        return decrypt_text(self.encrypted_password)

    def __str__(self):
        return f"{self.name} ({self.db_type})"


class DatabaseConfig(models.Model):
    """Backup schedule and retention policy for a single database."""

    database = models.ForeignKey(Database, on_delete=models.CASCADE, related_name="configs")
    backup_frequency_minutes = models.PositiveIntegerField(default=60)
    retention_days = models.PositiveIntegerField(default=7)
    # Selective scheduling: list of weekday ints (0=Mon … 6=Sun). Empty = every day.
    backup_days_of_week = models.JSONField(
        default=list,
        blank=True,
        help_text="Weekday numbers to run backups on (0=Mon … 6=Sun). Empty list means every day.",
    )
    # Retention exceptions
    retention_keep_monthly_first = models.BooleanField(
        default=False,
        help_text="Keep all backups whose completed date falls on the 1st of any month.",
    )
    retention_keep_weekly_day = models.IntegerField(
        null=True,
        blank=True,
        help_text="Keep backups created on this weekday (0=Mon … 6=Sun). Null = no exception.",
    )
    last_backup_at = models.DateTimeField(null=True, blank=True)
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self):
        return f"Config for {self.database.name}"


class ReplicationPolicy(models.Model):
    """
    When a backup for ``database_config`` succeeds, replicate the backup
    file to ``storage_host`` via SFTP.
    Backups are stored locally by default; replication only happens when
    a policy is defined.
    """

    database_config = models.ForeignKey(DatabaseConfig, on_delete=models.CASCADE, related_name="replication_policies")
    storage_host = models.ForeignKey(StorageHost, on_delete=models.CASCADE, related_name="replication_policies")
    remote_path = models.CharField(max_length=500, default="/backups", help_text="Remote directory on the SSH server")
    enabled = models.BooleanField(default=True)
    # Independent schedule (null = trigger after every successful backup)
    replication_frequency_minutes = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Run replication on this independent interval (minutes). Null = after every backup.",
    )
    last_replicated_at = models.DateTimeField(
        null=True, blank=True, help_text="Set by the independent scheduler after replication runs."
    )
    # Separate retention for replicated copies
    replication_retention_days = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Delete replicated copies older than this many days. Null = no separate retention.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        unique_together = ("database_config", "storage_host")

    def __str__(self):
        return f"Replicate {self.database_config} → {self.storage_host}"
