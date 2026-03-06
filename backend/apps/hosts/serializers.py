from datetime import datetime, time, timedelta

from rest_framework import serializers
from django.utils import timezone

from .access import accessible_configs_for_user, accessible_databases_for_user, accessible_storage_hosts_for_user
from .models import (
    Database,
    DatabaseConfig,
    DatabaseConfigVersion,
    DatabaseType,
    ReplicationPolicy,
    ReplicationPolicyVersion,
    RestoreConfig,
    RestoreConfigVersion,
    SqliteLocation,
    StorageHost,
)


def _resolve_effective_window(schedule_for_date):
    if schedule_for_date is None:
        return timezone.now(), None

    current_timezone = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(schedule_for_date, time.min), current_timezone)
    return start, start + timedelta(days=1)


def _validate_one_time_schedule(attrs):
    schedule_for_date = attrs.get("schedule_for_date")
    is_one_time_event = attrs.get("is_one_time_event", False)

    if schedule_for_date is not None and not is_one_time_event:
        raise serializers.ValidationError("schedule_for_date requires is_one_time_event=true.")
    if is_one_time_event and schedule_for_date is None:
        raise serializers.ValidationError("schedule_for_date is required for one-time events.")
    if schedule_for_date is not None and schedule_for_date < timezone.localdate():
        raise serializers.ValidationError("One-time events cannot be scheduled in the past.")


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
    username = serializers.CharField(required=False, allow_blank=True, default="")
    sqlite_location = serializers.ChoiceField(choices=SqliteLocation.choices, required=False, default=SqliteLocation.LOCAL)
    sqlite_path = serializers.CharField(required=False, allow_blank=True, default="")

    class Meta:
        model = Database
        fields = (
            "id",
            "name",
            "alias",
            "db_type",
            "host",
            "port",
            "username",
            "password",
            "sqlite_location",
            "sqlite_path",
            "owner",
            "is_active",
            "created_at",
        )
        read_only_fields = ("id", "owner", "created_at")

    def validate(self, attrs):
        db_type = attrs.get("db_type", getattr(self.instance, "db_type", None))
        host = attrs.get("host", getattr(self.instance, "host", ""))
        port = attrs.get("port", getattr(self.instance, "port", None))
        username = attrs.get("username", getattr(self.instance, "username", ""))
        sqlite_location = attrs.get("sqlite_location", getattr(self.instance, "sqlite_location", SqliteLocation.LOCAL))
        sqlite_path = attrs.get("sqlite_path", getattr(self.instance, "sqlite_path", ""))
        alias = attrs.get("alias", getattr(self.instance, "alias", ""))
        name = attrs.get("name", getattr(self.instance, "name", ""))

        if db_type in {DatabaseType.POSTGRES, DatabaseType.MYSQL}:
            if not host:
                raise serializers.ValidationError("Host is required for database connections.")
            if not port:
                raise serializers.ValidationError("Port is required for database connections.")
            if not username:
                raise serializers.ValidationError("Username is required for database connections.")
            if not alias:
                raise serializers.ValidationError("Alias is required for database connections.")
            return attrs

        if db_type == DatabaseType.SQLITE:
            if not sqlite_path and host:
                sqlite_path = host
                attrs["sqlite_path"] = sqlite_path
            if sqlite_location == SqliteLocation.REMOTE:
                if not host:
                    raise serializers.ValidationError("SSH host is required for remote SQLite databases.")
                if not port:
                    raise serializers.ValidationError("SSH port is required for remote SQLite databases.")
                if not username:
                    raise serializers.ValidationError("SSH username is required for remote SQLite databases.")
                if not sqlite_path:
                    raise serializers.ValidationError("SQLite path is required for remote SQLite databases.")
            else:
                if not sqlite_path:
                    raise serializers.ValidationError("SQLite path is required for local SQLite databases.")
                if not host:
                    attrs["host"] = sqlite_path
            if not alias:
                attrs["alias"] = name or sqlite_path
            return attrs

        return attrs

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
    schedule_for_date = serializers.DateField(write_only=True, required=False)
    is_one_time_event = serializers.BooleanField(required=False, default=False)

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
            "retention_exception_days",
            "retention_exception_max_days",
            "schedule_for_date",
            "last_backup_at",
            "enabled",
            "is_one_time_event",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "last_backup_at", "created_at", "updated_at")

    def validate(self, attrs):
        _validate_one_time_schedule(attrs)
        backup_frequency = attrs.get("backup_frequency_minutes")
        backup_days = attrs.get("backup_days_of_week")
        if backup_frequency == 0 and not backup_days:
            raise serializers.ValidationError(
                "backup_frequency_minutes must be greater than 0 when no backup_days_of_week are selected."
            )
        return attrs

    def validate_database(self, value):
        user = self.context["request"].user
        if not user.is_admin and not accessible_databases_for_user(user).filter(id=value.id).exists():
            raise serializers.ValidationError("Cannot create config for a database you cannot access.")
        return value

    def _roll_version(self, instance: DatabaseConfig, schedule_for_date=None):
        effective_from, effective_to = _resolve_effective_window(schedule_for_date)
        now = timezone.now()
        DatabaseConfigVersion.objects.filter(database_config=instance, effective_to__isnull=True).update(effective_to=now)
        DatabaseConfigVersion.objects.create(
            database_config=instance,
            database=instance.database,
            backup_frequency_minutes=instance.backup_frequency_minutes,
            retention_days=instance.retention_days,
            backup_days_of_week=instance.backup_days_of_week,
            retention_keep_monthly_first=instance.retention_keep_monthly_first,
            retention_keep_weekly_day=instance.retention_keep_weekly_day,
            retention_exception_days=instance.retention_exception_days,
            retention_exception_max_days=instance.retention_exception_max_days,
            enabled=instance.enabled,
            effective_from=effective_from,
            effective_to=effective_to,
        )

    def create(self, validated_data):
        schedule_for_date = validated_data.pop("schedule_for_date", None)
        is_one_time_event = validated_data.pop("is_one_time_event", False)
        instance = super().create({**validated_data, "is_one_time_event": is_one_time_event})
        self._roll_version(instance, schedule_for_date=schedule_for_date)
        return instance

    def update(self, instance, validated_data):
        validated_data.pop("schedule_for_date", None)
        tracked_fields = {
            "database",
            "backup_frequency_minutes",
            "retention_days",
            "backup_days_of_week",
            "retention_keep_monthly_first",
            "retention_keep_weekly_day",
            "retention_exception_days",
            "retention_exception_max_days",
            "enabled",
            "is_one_time_event",
        }
        should_roll = any(field in validated_data for field in tracked_fields)
        instance = super().update(instance, validated_data)
        if should_roll:
            self._roll_version(instance)
        return instance


class ReplicationPolicySerializer(serializers.ModelSerializer):
    schedule_for_date = serializers.DateField(write_only=True, required=False)
    is_one_time_event = serializers.BooleanField(required=False, default=False)

    class Meta:
        model = ReplicationPolicy
        fields = (
            "id",
            "database_config",
            "storage_host",
            "remote_path",
            "enabled",
            "replication_frequency_minutes",
            "replication_days_of_week",
            "last_replicated_at",
            "replication_retention_days",
            "replication_retention_exception_days",
            "replication_retention_exception_max_days",
            "schedule_for_date",
            "created_at",
            "updated_at",
            "is_one_time_event",
        )
        read_only_fields = ("id", "last_replicated_at", "created_at", "updated_at")

    def validate(self, attrs):
        _validate_one_time_schedule(attrs)
        user = self.context["request"].user
        replication_frequency = attrs.get(
            "replication_frequency_minutes",
            self.instance.replication_frequency_minutes if self.instance else None,
        )
        replication_days = attrs.get(
            "replication_days_of_week",
            self.instance.replication_days_of_week if self.instance else [],
        )
        if replication_frequency == 0 and not replication_days:
            raise serializers.ValidationError(
                "replication_frequency_minutes must be greater than 0 when no replication_days_of_week are selected."
            )
        if not user.is_admin:
            db_config = attrs.get("database_config") or (self.instance.database_config if self.instance else None)
            storage_host = attrs.get("storage_host") or (self.instance.storage_host if self.instance else None)
            if not accessible_configs_for_user(user).filter(id=db_config.id).exists():
                raise serializers.ValidationError("Cannot create policy for a database config you cannot access.")
            if not accessible_storage_hosts_for_user(user).filter(id=storage_host.id).exists():
                raise serializers.ValidationError("Cannot replicate to a storage host you cannot access.")
        return attrs

    def _roll_version(self, instance: ReplicationPolicy, schedule_for_date=None):
        effective_from, effective_to = _resolve_effective_window(schedule_for_date)
        now = timezone.now()
        ReplicationPolicyVersion.objects.filter(replication_policy=instance, effective_to__isnull=True).update(effective_to=now)
        ReplicationPolicyVersion.objects.create(
            replication_policy=instance,
            database_config=instance.database_config,
            storage_host=instance.storage_host,
            remote_path=instance.remote_path,
            enabled=instance.enabled,
            replication_frequency_minutes=instance.replication_frequency_minutes,
            replication_days_of_week=instance.replication_days_of_week,
            replication_retention_days=instance.replication_retention_days,
            replication_retention_exception_days=instance.replication_retention_exception_days,
            replication_retention_exception_max_days=instance.replication_retention_exception_max_days,
            effective_from=effective_from,
            effective_to=effective_to,
        )

    def create(self, validated_data):
        schedule_for_date = validated_data.pop("schedule_for_date", None)
        is_one_time_event = validated_data.pop("is_one_time_event", False)
        instance = super().create({**validated_data, "is_one_time_event": is_one_time_event})
        self._roll_version(instance, schedule_for_date=schedule_for_date)
        return instance

    def update(self, instance, validated_data):
        validated_data.pop("schedule_for_date", None)
        tracked_fields = {
            "database_config",
            "storage_host",
            "remote_path",
            "enabled",
            "replication_frequency_minutes",
            "replication_days_of_week",
            "replication_retention_days",
            "replication_retention_exception_days",
            "replication_retention_exception_max_days",
            "is_one_time_event",
        }
        should_roll = any(field in validated_data for field in tracked_fields)
        instance = super().update(instance, validated_data)
        if should_roll:
            self._roll_version(instance)
        return instance


class RestoreConfigSerializer(serializers.ModelSerializer):
    schedule_for_date = serializers.DateField(write_only=True, required=False)
    is_one_time_event = serializers.BooleanField(required=False, default=False)

    class Meta:
        model = RestoreConfig
        fields = (
            "id",
            "source_config",
            "target_database",
            "restore_frequency_minutes",
            "restore_days_of_week",
            "drop_target_on_success",
            "schedule_for_date",
            "last_restored_at",
            "enabled",
            "is_one_time_event",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "last_restored_at", "created_at", "updated_at")

    def validate(self, attrs):
        _validate_one_time_schedule(attrs)
        user = self.context["request"].user
        restore_frequency = attrs.get(
            "restore_frequency_minutes",
            self.instance.restore_frequency_minutes if self.instance else None,
        )
        restore_days = attrs.get(
            "restore_days_of_week",
            self.instance.restore_days_of_week if self.instance else [],
        )
        if restore_frequency == 0 and not restore_days:
            raise serializers.ValidationError(
                "restore_frequency_minutes must be greater than 0 when no restore_days_of_week are selected."
            )

        source_config = attrs.get("source_config") or (self.instance.source_config if self.instance else None)
        target_database = attrs.get("target_database") or (self.instance.target_database if self.instance else None)

        if source_config and target_database and source_config.database.db_type != target_database.db_type:
            raise serializers.ValidationError("Source config and target database must use the same database type.")

        drop_target = attrs.get(
            "drop_target_on_success",
            self.instance.drop_target_on_success if self.instance else False,
        )
        if drop_target and source_config and target_database and source_config.database_id == target_database.id:
            raise serializers.ValidationError("Cannot drop target when source and target database are the same.")

        if not user.is_admin and source_config and target_database:
            if not accessible_configs_for_user(user).filter(id=source_config.id).exists():
                raise serializers.ValidationError("Cannot create restore config for a source config you cannot access.")
            if not accessible_databases_for_user(user).filter(id=target_database.id).exists():
                raise serializers.ValidationError("Cannot target a database you cannot access.")

        return attrs

    def _roll_version(self, instance: RestoreConfig, schedule_for_date=None):
        effective_from, effective_to = _resolve_effective_window(schedule_for_date)
        now = timezone.now()
        RestoreConfigVersion.objects.filter(restore_config=instance, effective_to__isnull=True).update(effective_to=now)
        RestoreConfigVersion.objects.create(
            restore_config=instance,
            source_config=instance.source_config,
            target_database=instance.target_database,
            restore_frequency_minutes=instance.restore_frequency_minutes,
            restore_days_of_week=instance.restore_days_of_week,
            drop_target_on_success=instance.drop_target_on_success,
            enabled=instance.enabled,
            effective_from=effective_from,
            effective_to=effective_to,
        )

    def create(self, validated_data):
        schedule_for_date = validated_data.pop("schedule_for_date", None)
        is_one_time_event = validated_data.pop("is_one_time_event", False)
        instance = super().create({**validated_data, "is_one_time_event": is_one_time_event})
        self._roll_version(instance, schedule_for_date=schedule_for_date)
        return instance

    def update(self, instance, validated_data):
        validated_data.pop("schedule_for_date", None)
        tracked_fields = {
            "source_config",
            "target_database",
            "restore_frequency_minutes",
            "restore_days_of_week",
            "drop_target_on_success",
            "enabled",
            "is_one_time_event",
        }
        should_roll = any(field in validated_data for field in tracked_fields)
        instance = super().update(instance, validated_data)
        if should_roll:
            self._roll_version(instance)
        return instance


class DatabaseConfigVersionSerializer(serializers.ModelSerializer):
    is_one_time_event = serializers.BooleanField(source="database_config.is_one_time_event", read_only=True)

    class Meta:
        model = DatabaseConfigVersion
        fields = (
            "id",
            "database_config",
            "database",
            "backup_frequency_minutes",
            "retention_days",
            "backup_days_of_week",
            "retention_keep_monthly_first",
            "retention_keep_weekly_day",
            "retention_exception_days",
            "retention_exception_max_days",
            "enabled",
            "effective_from",
            "effective_to",
            "is_one_time_event",
            "created_at",
        )
        read_only_fields = fields


class ReplicationPolicyVersionSerializer(serializers.ModelSerializer):
    is_one_time_event = serializers.BooleanField(source="replication_policy.is_one_time_event", read_only=True)

    class Meta:
        model = ReplicationPolicyVersion
        fields = (
            "id",
            "replication_policy",
            "database_config",
            "storage_host",
            "remote_path",
            "enabled",
            "replication_frequency_minutes",
            "replication_days_of_week",
            "replication_retention_days",
            "replication_retention_exception_days",
            "replication_retention_exception_max_days",
            "effective_from",
            "effective_to",
            "is_one_time_event",
            "created_at",
        )
        read_only_fields = fields


class RestoreConfigVersionSerializer(serializers.ModelSerializer):
    is_one_time_event = serializers.BooleanField(source="restore_config.is_one_time_event", read_only=True)

    class Meta:
        model = RestoreConfigVersion
        fields = (
            "id",
            "restore_config",
            "source_config",
            "target_database",
            "restore_frequency_minutes",
            "restore_days_of_week",
            "drop_target_on_success",
            "enabled",
            "effective_from",
            "effective_to",
            "is_one_time_event",
            "created_at",
        )
        read_only_fields = fields
