from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from apps.audit.services import create_audit_log
from apps.hosts.access import accessible_configs_for_user
from apps.hosts.models import DatabaseConfig

from .models import Backup, BackupDeletionRequest, BackupStatus, DeletionRequestStatus, RestoreJob, RestoreStatus
from .serializers import (
    BackupSerializer,
    BackupDeletionRequestSerializer,
    DeleteBackupSerializer,
    ManualReplicationSerializer,
    ReviewDeletionRequestSerializer,
    RestoreJobSerializer,
    RestoreSerializer,
    TriggerBackupSerializer,
)
from .services import delete_backup_artifacts, get_backup_preflight_error
from .tasks import run_backup_task, run_replication_task, run_restore_task


class RestoreThrottle(UserRateThrottle):
    scope = "restore"

    def get_rate(self):
        try:
            from apps.common.models import SiteSettings
            return SiteSettings.get().restore_throttle_rate
        except Exception:
            return "30/hour"


class ManualBackupThrottle(UserRateThrottle):
    scope = "manual_backup"

    def get_rate(self):
        try:
            from apps.common.models import SiteSettings
            return SiteSettings.get().manual_backup_throttle_rate
        except Exception:
            return "60/hour"


class BackupViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = (
        Backup.objects.select_related(
            "database_config",
            "database_config__database",
            "database_config__database__owner",
        )
        .prefetch_related("replications__storage_host")
        .all()
    )
    serializer_class = BackupSerializer
    permission_classes = (IsAuthenticated,)

    def _filter_configs_for_user(self, queryset, user):
        if user.is_admin:
            return queryset
        return queryset.filter(id__in=accessible_configs_for_user(user).values_list("id", flat=True))

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.is_admin:
            return queryset
        accessible_config_ids = accessible_configs_for_user(user).values_list("id", flat=True)
        return queryset.filter(database_config_id__in=accessible_config_ids)

    @action(detail=False, methods=["post"], throttle_classes=[ManualBackupThrottle], url_path="trigger")
    def trigger(self, request):
        """Trigger a backup immediately for a specific database config."""
        serializer = TriggerBackupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        config = serializer.validated_data["database_config"]
        allowed_configs = self._filter_configs_for_user(DatabaseConfig.objects.all(), request.user)
        if not allowed_configs.filter(id=config.id).exists():
            raise PermissionDenied("You cannot trigger backups for this database config.")

        preflight_error = get_backup_preflight_error(config)
        if preflight_error:
            return Response({"detail": preflight_error}, status=status.HTTP_400_BAD_REQUEST)

        try:
            from config.celery import app as celery_app

            online_workers = celery_app.control.ping(timeout=1.0)
            if not online_workers:
                return Response(
                    {
                        "detail": "No Celery workers are online. Start a worker and retry.",
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
        except Exception:
            return Response(
                {
                    "detail": "Unable to reach Celery workers. Verify Redis and worker status.",
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        pending_backup = Backup.objects.create(
            database_config=config,
            file_path="",
            status=BackupStatus.PENDING,
            metadata={"trigger": "manual"},
        )

        transaction.on_commit(lambda: run_backup_task.delay(config.id, pending_backup.id))
        create_audit_log(
            user=request.user,
            action="BACKUP_TRIGGERED_MANUAL",
            target=f"DatabaseConfig:{config.id}",
            metadata={"database_name": config.database.name, "backup_id": pending_backup.id},
        )
        return Response(
            {
                "status": "backup_accepted",
                "database_config": config.id,
                "database": config.database.name,
                "backup_id": pending_backup.id,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=False, methods=["get"], url_path="live")
    def live(self, request):
        """Return active and recent backup/replication state for live monitoring."""
        base_queryset = self.get_queryset()
        active = list(base_queryset.filter(status__in=[BackupStatus.PENDING, BackupStatus.RUNNING])[:25])
        recent = list(base_queryset[:50])

        active_ids = {item.id for item in active}
        merged = active + [item for item in recent if item.id not in active_ids]
        serializer = self.get_serializer(merged, many=True)

        running_backups = sum(1 for item in merged if item.status == BackupStatus.RUNNING)
        pending_backups = sum(1 for item in merged if item.status == BackupStatus.PENDING)
        running_replications = 0
        pending_replications = 0
        failed_replications = 0
        for item in merged:
            for rep in item.replications.all():
                if rep.status == "RUNNING":
                    running_replications += 1
                elif rep.status == "PENDING":
                    pending_replications += 1
                elif rep.status == "FAILED":
                    failed_replications += 1

        return Response(
            {
                "server_time": timezone.now(),
                "summary": {
                    "running_backups": running_backups,
                    "pending_backups": pending_backups,
                    "running_replications": running_replications,
                    "pending_replications": pending_replications,
                    "failed_replications": failed_replications,
                    "total_items": len(merged),
                },
                "items": serializer.data,
            }
        )

    @action(detail=False, methods=["get"], url_path="live-restorations")
    def live_restorations(self, request):
        """Return active and recent restore jobs for live monitoring."""
        user = request.user
        qs = RestoreJob.objects.select_related("backup__database_config__database", "triggered_by").all()
        if not user.is_admin:
            qs = qs.filter(backup__database_config__database__owner=user)

        active = list(qs.filter(status__in=[RestoreStatus.PENDING, RestoreStatus.RUNNING])[:25])
        recent = list(qs[:50])
        active_ids = {r.id for r in active}
        merged = active + [r for r in recent if r.id not in active_ids]

        serializer = RestoreJobSerializer(merged, many=True)
        return Response(
            {
                "server_time": timezone.now(),
                "summary": {
                    "running_restorations": sum(1 for r in merged if r.status == RestoreStatus.RUNNING),
                    "pending_restorations": sum(1 for r in merged if r.status == RestoreStatus.PENDING),
                    "total_items": len(merged),
                },
                "items": serializer.data,
            }
        )

    @action(detail=False, methods=["get"], url_path="restores")
    def restores(self, request):
        """Return restore jobs for planning/history views."""
        user = request.user
        qs = RestoreJob.objects.select_related("backup__database_config__database", "triggered_by").all()
        if not user.is_admin:
            qs = qs.filter(backup__database_config__database__owner=user)
        serializer = RestoreJobSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], throttle_classes=[RestoreThrottle])
    def restore(self, request, pk=None):
        """
        Trigger an asynchronous restore of this backup.

        Body:
          { "target_db": "<db name or file path>", "confirmation_phrase": "CONFIRM RESTORE" }
        """
        backup = self.get_object()

        if backup.status != BackupStatus.SUCCESS:
            return Response(
                {"detail": "Only successful backups can be restored."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = RestoreSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        target_db = serializer.validated_data["target_db"]

        create_audit_log(
            user=request.user,
            action="RESTORE_TRIGGERED",
            target=f"Backup:{backup.id}",
            metadata={"target_db": target_db},
        )

        run_restore_task.delay(backup.id, target_db, request.user.id)

        return Response(
            {"status": "restore_accepted", "backup_id": backup.id, "target_db": target_db},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["post"], url_path="replicate")
    def replicate(self, request, pk=None):
        """Trigger manual replication of a successful backup to selected configured replication hosts."""
        backup = self.get_object()

        if backup.status != BackupStatus.SUCCESS:
            return Response(
                {"detail": "Only successful backups can be replicated."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = ManualReplicationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        requested_host_ids = serializer.validated_data["storage_host_ids"]

        policies = list(
            backup.database_config.replication_policies.filter(enabled=True, storage_host_id__in=requested_host_ids)
        )
        matched_ids = {policy.storage_host_id for policy in policies}
        missing_ids = [host_id for host_id in requested_host_ids if host_id not in matched_ids]
        if missing_ids:
            return Response(
                {
                    "detail": "One or more selected hosts are not enabled replication targets for this backup config.",
                    "invalid_storage_host_ids": missing_ids,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            from config.celery import app as celery_app

            online_workers = celery_app.control.ping(timeout=1.0)
            if not online_workers:
                return Response(
                    {"detail": "No Celery workers are online. Start a worker and retry."},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
        except Exception:
            return Response(
                {"detail": "Unable to reach Celery workers. Verify Redis and worker status."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        for policy in policies:
            transaction.on_commit(
                lambda b_id=backup.id, h_id=policy.storage_host_id, remote=policy.remote_path: run_replication_task.delay(
                    b_id,
                    h_id,
                    remote,
                )
            )

        create_audit_log(
            user=request.user,
            action="REPLICATION_TRIGGERED_MANUAL",
            target=f"Backup:{backup.id}",
            metadata={"storage_host_ids": requested_host_ids},
        )
        return Response(
            {
                "status": "replication_accepted",
                "backup_id": backup.id,
                "storage_host_ids": requested_host_ids,
                "count": len(requested_host_ids),
            },
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["delete"])
    def manual_delete(self, request, pk=None):
        backup = self.get_object()
        user = request.user
        serializer = DeleteBackupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        delete_replications = serializer.validated_data["delete_replications"]

        if not user.is_admin:
            if backup.status != BackupStatus.SUCCESS:
                raise PermissionDenied("Only successful backups can be requested for deletion.")
            existing_pending = BackupDeletionRequest.objects.filter(
                backup=backup,
                requested_by=user,
                status=DeletionRequestStatus.PENDING,
            ).exists()
            if existing_pending:
                return Response(
                    {"detail": "A pending deletion request already exists for this backup."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            deletion_request = BackupDeletionRequest.objects.create(
                backup=backup,
                requested_by=user,
                delete_replications=delete_replications,
            )
            create_audit_log(
                user=user,
                action="BACKUP_DELETE_REQUESTED",
                target=f"Backup:{backup.id}",
                metadata={
                    "database_config_id": backup.database_config_id,
                    "delete_request_id": deletion_request.id,
                    "delete_replications": delete_replications,
                },
            )
            return Response(
                {
                    "status": "deletion_requested",
                    "backup_id": backup.id,
                    "deletion_request_id": deletion_request.id,
                },
                status=status.HTTP_202_ACCEPTED,
            )

        delete_backup_artifacts(backup, delete_replications=delete_replications)
        create_audit_log(
            user=user,
            action="BACKUP_DELETED_MANUAL",
            target=f"Backup:{backup.id}",
            metadata={"database_config_id": backup.database_config_id, "delete_replications": delete_replications},
        )
        backup.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"], url_path="deletion-requests")
    def deletion_requests(self, request):
        if not request.user.is_admin:
            raise PermissionDenied("Only admins can review deletion requests.")

        queryset = BackupDeletionRequest.objects.select_related(
            "backup",
            "backup__database_config__database",
            "requested_by",
            "reviewed_by",
        ).all()
        serializer = BackupDeletionRequestSerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["post"], url_path=r"deletion-requests/(?P<request_id>[^/.]+)/review")
    def review_deletion_request(self, request, request_id=None):
        if not request.user.is_admin:
            raise PermissionDenied("Only admins can review deletion requests.")

        review_serializer = ReviewDeletionRequestSerializer(data=request.data)
        review_serializer.is_valid(raise_exception=True)

        deletion_request = BackupDeletionRequest.objects.select_related("backup").filter(id=request_id).first()
        if deletion_request is None:
            return Response({"detail": "Deletion request not found."}, status=status.HTTP_404_NOT_FOUND)
        if deletion_request.status != DeletionRequestStatus.PENDING:
            return Response({"detail": "Deletion request is already reviewed."}, status=status.HTTP_400_BAD_REQUEST)

        action_value = review_serializer.validated_data["action"]
        admin_note = review_serializer.validated_data.get("admin_note", "")

        deletion_request.status = action_value
        deletion_request.reviewed_by = request.user
        deletion_request.reviewed_at = timezone.now()
        deletion_request.admin_note = admin_note
        deletion_request.save(update_fields=["status", "reviewed_by", "reviewed_at", "admin_note"])

        if action_value == DeletionRequestStatus.APPROVED:
            backup = deletion_request.backup
            delete_backup_artifacts(backup, delete_replications=deletion_request.delete_replications)
            create_audit_log(
                user=request.user,
                action="BACKUP_DELETE_APPROVED",
                target=f"Backup:{backup.id}",
                metadata={
                    "delete_request_id": deletion_request.id,
                    "delete_replications": deletion_request.delete_replications,
                    "admin_note": admin_note,
                },
            )
            backup.delete()
        else:
            create_audit_log(
                user=request.user,
                action="BACKUP_DELETE_DENIED",
                target=f"Backup:{deletion_request.backup_id}",
                metadata={"delete_request_id": deletion_request.id, "admin_note": admin_note},
            )
        return Response({"status": deletion_request.status, "deletion_request_id": deletion_request.id})
