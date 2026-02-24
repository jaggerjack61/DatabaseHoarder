from rest_framework import serializers

from apps.hosts.models import DatabaseConfig

from .models import Backup, BackupDeletionRequest, BackupReplication, DeletionRequestStatus, RestoreJob


class BackupReplicationSerializer(serializers.ModelSerializer):
    class Meta:
        model = BackupReplication
        fields = ("id", "storage_host", "remote_path", "status", "started_at", "completed_at", "error_message")
        read_only_fields = fields


class BackupSerializer(serializers.ModelSerializer):
    replications = BackupReplicationSerializer(many=True, read_only=True)

    class Meta:
        model = Backup
        fields = (
            "id",
            "database_config",
            "file_path",
            "file_size",
            "checksum",
            "started_at",
            "completed_at",
            "status",
            "error_message",
            "metadata",
            "replications",
        )
        read_only_fields = (
            "id",
            "file_path",
            "file_size",
            "checksum",
            "started_at",
            "completed_at",
            "status",
            "error_message",
            "metadata",
            "replications",
        )


class RestoreSerializer(serializers.Serializer):
    """
    Payload for the restore endpoint.

    ``target_db`` is:
      - PostgreSQL / MySQL: the name of the database to restore into
      - SQLite: the file path to restore to
    """

    target_db = serializers.CharField(help_text="Target database name (or file path for SQLite)")
    confirmation_phrase = serializers.CharField()

    def validate_confirmation_phrase(self, value):
        if value != "CONFIRM RESTORE":
            raise serializers.ValidationError("Must be exactly: CONFIRM RESTORE")
        return value


class TriggerBackupSerializer(serializers.Serializer):
    database_config = serializers.PrimaryKeyRelatedField(queryset=DatabaseConfig.objects.all())


class ManualReplicationSerializer(serializers.Serializer):
    storage_host_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
        help_text="Storage host IDs to replicate this backup to.",
    )

    def validate_storage_host_ids(self, value):
        unique_ids = list(dict.fromkeys(value))
        if not unique_ids:
            raise serializers.ValidationError("Select at least one replication host.")
        return unique_ids


class DeleteBackupSerializer(serializers.Serializer):
    confirmation_phrase = serializers.CharField()
    delete_replications = serializers.BooleanField(default=False)

    def validate_confirmation_phrase(self, value):
        if value.strip().lower() != "delete":
            raise serializers.ValidationError("Must type exactly: delete")
        return value


class BackupDeletionRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = BackupDeletionRequest
        fields = (
            "id",
            "backup",
            "requested_by",
            "delete_replications",
            "status",
            "reviewed_by",
            "reviewed_at",
            "admin_note",
            "created_at",
        )
        read_only_fields = fields


class ReviewDeletionRequestSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=(DeletionRequestStatus.APPROVED, DeletionRequestStatus.DENIED))
    admin_note = serializers.CharField(required=False, allow_blank=True, default="")


class RestoreJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = RestoreJob
        fields = (
            "id",
            "backup",
            "target_db",
            "triggered_by",
            "status",
            "started_at",
            "completed_at",
            "error_message",
        )
        read_only_fields = fields
