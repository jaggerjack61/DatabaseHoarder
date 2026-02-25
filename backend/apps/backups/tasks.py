from celery import shared_task
from django.db import close_old_connections
from django.utils import timezone

from apps.hosts.models import DatabaseConfig

from .services import execute_backup, execute_replication, execute_restore


@shared_task
def run_backup_task(config_id: int, backup_id: int | None = None):
    """Execute a backup for the given DatabaseConfig id."""
    close_old_connections()
    execute_backup(config_id, backup_id=backup_id)


@shared_task
def run_replication_task(backup_id: int, storage_host_id: int, remote_dir: str):
    """Replicate a completed backup to a StorageHost via SFTP."""
    close_old_connections()
    execute_replication(backup_id, storage_host_id, remote_dir)


@shared_task
def run_restore_task(backup_id: int, target_db: str, user_id: int):
    """Execute a restore asynchronously."""
    close_old_connections()
    from apps.users.models import User

    user = User.objects.get(id=user_id)
    execute_restore(backup_id, target_db, user)


@shared_task
def schedule_due_backups():
    """Periodic task that checks which configs are due for a backup and enqueues them."""
    close_old_connections()
    now = timezone.now()
    today_weekday = now.weekday()  # 0=Mon … 6=Sun
    queryset = DatabaseConfig.objects.filter(enabled=True, database__is_active=True).select_related("database")

    for config in queryset:
        allowed_days = config.backup_days_of_week or []
        day_due = bool(allowed_days) and today_weekday in allowed_days
        interval_due = False
        if config.backup_frequency_minutes:
            if config.last_backup_at is None:
                interval_due = True
            else:
                elapsed_minutes = (now - config.last_backup_at).total_seconds() / 60
                interval_due = elapsed_minutes >= config.backup_frequency_minutes
        if day_due or interval_due:
            run_backup_task.delay(config.id)


@shared_task
def schedule_due_replications():
    """
    Periodic task for replication policies with an independent schedule.
    Finds the latest successful backup for each due policy and enqueues replication.
    """
    close_old_connections()
    from apps.hosts.models import ReplicationPolicy

    from .models import Backup, BackupStatus
    from .services import apply_replication_retention

    now = timezone.now()
    policies = ReplicationPolicy.objects.filter(enabled=True).select_related("database_config__database", "storage_host")

    for policy in policies:
        allowed_days = policy.replication_days_of_week or []
        day_due = bool(allowed_days) and now.weekday() in allowed_days
        interval_due = False
        if policy.replication_frequency_minutes is not None and policy.replication_frequency_minutes > 0:
            if policy.last_replicated_at is None:
                interval_due = True
            else:
                elapsed = (now - policy.last_replicated_at).total_seconds() / 60
                interval_due = elapsed >= policy.replication_frequency_minutes
        if not (day_due or interval_due):
            continue

        # Find the latest successful backup for this config
        latest = (
            Backup.objects.filter(
                database_config=policy.database_config,
                status=BackupStatus.SUCCESS,
            )
            .order_by("-completed_at")
            .first()
        )
        if latest is None:
            continue

        run_replication_task.delay(latest.id, policy.storage_host_id, policy.remote_path)
        policy.last_replicated_at = now
        policy.save(update_fields=["last_replicated_at"])

        # Apply separate retention if configured
        apply_replication_retention(policy)
