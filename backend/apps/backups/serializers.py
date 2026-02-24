from rest_framework import serializers

from apps.hosts.models import DatabaseConfig

from .models import Backup, BackupReplication, RestoreJob


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
