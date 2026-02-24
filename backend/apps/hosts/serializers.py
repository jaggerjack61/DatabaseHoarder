from rest_framework import serializers

from .access import accessible_configs_for_user, accessible_databases_for_user, accessible_storage_hosts_for_user
from .models import Database, DatabaseConfig, ReplicationPolicy, StorageHost


class StorageHostSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, default="")

    class Meta:
        model = StorageHost
        fields = ("id", "name", "address", "ssh_port", "username", "password", "owner", "is_active", "created_at")
        read_only_fields = ("id", "owner", "created_at")

    def create(self, validated_data):
        raw_password = validated_data.pop("password", "")
        validated_data["owner"] = self.context["request"].user
        instance = StorageHost(**validated_data)
        instance.set_password(raw_password)
        instance.save()
        return instance

    def update(self, instance, validated_data):
        raw_password = validated_data.pop("password", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if raw_password is not None:
            instance.set_password(raw_password)
        instance.save()
        return instance


class DatabaseSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, default="")

    class Meta:
        model = Database
        fields = ("id", "name", "db_type", "host", "port", "username", "password", "owner", "is_active", "created_at")
        read_only_fields = ("id", "owner", "created_at")

    def create(self, validated_data):
        raw_password = validated_data.pop("password", "")
        validated_data["owner"] = self.context["request"].user
        instance = Database(**validated_data)
        instance.set_password(raw_password)
        instance.save()
        return instance

    def update(self, instance, validated_data):
        raw_password = validated_data.pop("password", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if raw_password is not None:
            instance.set_password(raw_password)
        instance.save()
        return instance


class DatabaseConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = DatabaseConfig
        fields = (
            "id",
            "database",
            "backup_frequency_minutes",
            "retention_days",
            "backup_days_of_week",
            "retention_keep_monthly_first",
            "retention_keep_weekly_day",
            "last_backup_at",
            "enabled",
            "created_at",
        )
        read_only_fields = ("id", "last_backup_at", "created_at")

    def validate_database(self, value):
        user = self.context["request"].user
        if not user.is_admin and not accessible_databases_for_user(user).filter(id=value.id).exists():
            raise serializers.ValidationError("Cannot create config for a database you cannot access.")
        return value


class ReplicationPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = ReplicationPolicy
        fields = (
            "id",
            "database_config",
            "storage_host",
            "remote_path",
            "enabled",
            "replication_frequency_minutes",
            "last_replicated_at",
            "replication_retention_days",
            "created_at",
        )
        read_only_fields = ("id", "last_replicated_at", "created_at")

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.is_admin:
            db_config = attrs["database_config"]
            storage_host = attrs["storage_host"]
            if not accessible_configs_for_user(user).filter(id=db_config.id).exists():
                raise serializers.ValidationError("Cannot create policy for a database config you cannot access.")
            if not accessible_storage_hosts_for_user(user).filter(id=storage_host.id).exists():
                raise serializers.ValidationError("Cannot replicate to a storage host you cannot access.")
        return attrs
