from celery import shared_task
from django.db import close_old_connections
from django.utils import timezone

from apps.hosts.models import DatabaseConfig, RestoreConfig

from .services import execute_backup, execute_replication, execute_restore


def _max_retries() -> int:
    try:
        from apps.common.models import SiteSettings
        return SiteSettings.get().max_task_retries
    except Exception:
        return 3


@shared_task(bind=True)
def run_backup_task(self, config_id: int, backup_id: int | None = None):
    """Execute a backup for the given DatabaseConfig id."""
    close_old_connections()
    try:
        execute_backup(config_id, backup_id=backup_id)
    except Exception as exc:
        raise self.retry(exc=exc, max_retries=_max_retries(), countdown=30 * (self.request.retries + 1))


@shared_task(bind=True)
def run_replication_task(self, backup_id: int, storage_host_id: int, remote_dir: str):
    """Replicate a completed backup to a StorageHost via SFTP."""
    close_old_connections()
    try:
        execute_replication(backup_id, storage_host_id, remote_dir)
    except Exception as exc:
        raise self.retry(exc=exc, max_retries=_max_retries(), countdown=30 * (self.request.retries + 1))


@shared_task(bind=True)
def run_restore_task(self, backup_id: int, target_db: str, user_id: int):
    """Execute a restore asynchronously."""
    close_old_connections()
    from apps.users.models import User

    user = User.objects.get(id=user_id)
    try:
        execute_restore(backup_id, target_db, user)
    except Exception as exc:
        raise self.retry(exc=exc, max_retries=_max_retries(), countdown=30 * (self.request.retries + 1))


@shared_task(bind=True)
def run_restore_config_task(self, restore_config_id: int):
    """Run a scheduled restore config using the latest successful backup."""
    close_old_connections()
    from .models import Backup, BackupStatus

    restore_config = RestoreConfig.objects.select_related(
        "source_config__database__owner",
        "target_database",
    ).get(id=restore_config_id)
    source_config = restore_config.source_config

    latest_backup = (
        Backup.objects.filter(database_config=source_config, status=BackupStatus.SUCCESS)
        .order_by("-completed_at")
        .first()
    )
    if latest_backup is None:
        return

    try:
        execute_restore(
            latest_backup.id,
            target_db=restore_config.target_database.name,
            user=source_config.database.owner,
            target_database_id=restore_config.target_database_id,
            drop_target_on_success=restore_config.drop_target_on_success,
        )
    except Exception as exc:
        raise self.retry(exc=exc, max_retries=_max_retries(), countdown=30 * (self.request.retries + 1))


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


@shared_task
def schedule_due_restores():
    """Periodic task that enqueues due restore configs."""
    close_old_connections()
    now = timezone.now()
    weekday = now.weekday()
    queryset = RestoreConfig.objects.filter(
        enabled=True,
        source_config__enabled=True,
        source_config__database__is_active=True,
        target_database__is_active=True,
    ).select_related("source_config", "target_database")

    for restore_config in queryset:
        allowed_days = restore_config.restore_days_of_week or []
        day_due = bool(allowed_days) and weekday in allowed_days
        if day_due and restore_config.last_restored_at and restore_config.last_restored_at.date() == now.date():
            day_due = False

        interval_due = False
        if restore_config.restore_frequency_minutes:
            if restore_config.last_restored_at is None:
                interval_due = True
            else:
                elapsed = (now - restore_config.last_restored_at).total_seconds() / 60
                interval_due = elapsed >= restore_config.restore_frequency_minutes

        if not (day_due or interval_due):
            continue

        run_restore_config_task.delay(restore_config.id)
        restore_config.last_restored_at = now
        restore_config.save(update_fields=["last_restored_at"])
