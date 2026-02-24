from django.conf import settings
from django.db import models

from apps.hosts.models import DatabaseConfig, StorageHost


class BackupStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    RUNNING = "RUNNING", "Running"
    SUCCESS = "SUCCESS", "Success"
    FAILED = "FAILED", "Failed"


class Backup(models.Model):
    """
    A single backup run for a DatabaseConfig.
    The file is always stored locally first (MEDIA_ROOT/backups/…).
    Replication to storage hosts is tracked in BackupReplication.
    """

    database_config = models.ForeignKey(DatabaseConfig, on_delete=models.CASCADE, related_name="backups")
    file_path = models.CharField(max_length=500)
    file_size = models.BigIntegerField(default=0)
    checksum = models.CharField(max_length=128, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=BackupStatus.choices, default=BackupStatus.PENDING)
    error_message = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("-started_at", "-id")

    def __str__(self):
        return f"Backup {self.id} ({self.status})"


class ReplicationStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    RUNNING = "RUNNING", "Running"
    SUCCESS = "SUCCESS", "Success"
    FAILED = "FAILED", "Failed"


class BackupReplication(models.Model):
    """Tracks the SFTP replication of a Backup to a StorageHost."""

    backup = models.ForeignKey(Backup, on_delete=models.CASCADE, related_name="replications")
    storage_host = models.ForeignKey(StorageHost, on_delete=models.CASCADE, related_name="replications")
    remote_path = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=16, choices=ReplicationStatus.choices, default=ReplicationStatus.PENDING)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True)

    class Meta:
        ordering = ("-started_at", "-id")
        unique_together = ("backup", "storage_host")

    def __str__(self):
        return f"Replication Backup:{self.backup_id} → {self.storage_host}"


class RestoreStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    RUNNING = "RUNNING", "Running"
    SUCCESS = "SUCCESS", "Success"
    FAILED = "FAILED", "Failed"


class RestoreJob(models.Model):
    """Tracks an asynchronous restore operation triggered by a user."""

    backup = models.ForeignKey(Backup, on_delete=models.CASCADE, related_name="restore_jobs")
    target_db = models.CharField(max_length=500, help_text="DB name or file path that was restored into")
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="restore_jobs",
    )
    status = models.CharField(max_length=16, choices=RestoreStatus.choices, default=RestoreStatus.PENDING)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True)

    class Meta:
        ordering = ("-started_at", "-id")

    def __str__(self):
        return f"RestoreJob {self.id} ({self.status})"
