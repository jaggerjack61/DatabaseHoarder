from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from apps.hosts.models import Database, DatabaseConfig, ReplicationPolicy, RestoreConfig, StorageHost
from .models import AccessProfile

User = get_user_model()
REGULAR_CONFIGS_QUERYSET = DatabaseConfig.objects.filter(is_one_time_event=False)
REGULAR_REPLICATION_QUERYSET = ReplicationPolicy.objects.filter(is_one_time_event=False)
REGULAR_RESTORE_QUERYSET = RestoreConfig.objects.filter(is_one_time_event=False)


class AccessProfileSerializer(serializers.ModelSerializer):
    granted_storage_hosts = serializers.PrimaryKeyRelatedField(queryset=StorageHost.objects.all(), many=True, required=False)
    granted_databases = serializers.PrimaryKeyRelatedField(queryset=Database.objects.all(), many=True, required=False)
    granted_database_configs = serializers.PrimaryKeyRelatedField(queryset=REGULAR_CONFIGS_QUERYSET, many=True, required=False)
    granted_replication_policies = serializers.PrimaryKeyRelatedField(queryset=REGULAR_REPLICATION_QUERYSET, many=True, required=False)
    granted_restore_configs = serializers.PrimaryKeyRelatedField(queryset=REGULAR_RESTORE_QUERYSET, many=True, required=False)

    class Meta:
        model = AccessProfile
        fields = (
            "id",
            "name",
            "description",
            "granted_storage_hosts",
            "granted_databases",
            "granted_database_configs",
            "granted_replication_policies",
            "granted_restore_configs",
        )


class UserSerializer(serializers.ModelSerializer):
    access_profiles = serializers.PrimaryKeyRelatedField(queryset=AccessProfile.objects.all(), many=True, required=False)

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "role",
            "is_active",
            "date_joined",
            "access_profiles",
        )
        read_only_fields = ("id", "date_joined")

    def validate(self, attrs):
        role = attrs.get("role", self.instance.role if self.instance else None)
        selected_profiles = attrs.get("access_profiles", None)

        if self.instance:
            has_profiles = bool(selected_profiles) if selected_profiles is not None else self.instance.access_profiles.exists()
        else:
            has_profiles = bool(selected_profiles)

        if role == "USER" and not has_profiles:
            raise serializers.ValidationError("USER accounts must have at least one access profile.")
        return attrs


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)
    access_profiles = serializers.PrimaryKeyRelatedField(queryset=AccessProfile.objects.all(), many=True, required=False)

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "password",
            "role",
            "access_profiles",
        )

    def validate(self, attrs):
        role = attrs.get("role")
        selected_profiles = attrs.get("access_profiles", [])
        if role == "USER" and not selected_profiles:
            raise serializers.ValidationError("USER accounts must have at least one access profile.")
        return attrs

    def validate_password(self, value):
        user = User(
            username=self.initial_data.get("username", ""),
            email=self.initial_data.get("email", ""),
        )
        validate_password(value, user=user)
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        access_profiles = validated_data.pop("access_profiles", [])
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        if access_profiles:
            user.access_profiles.set(access_profiles)
        return user
