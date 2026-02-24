from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from apps.hosts.models import Database, DatabaseConfig, StorageHost
from .models import AccessProfile

User = get_user_model()


class AccessProfileSerializer(serializers.ModelSerializer):
    granted_storage_hosts = serializers.PrimaryKeyRelatedField(queryset=StorageHost.objects.all(), many=True, required=False)
    granted_databases = serializers.PrimaryKeyRelatedField(queryset=Database.objects.all(), many=True, required=False)
    granted_database_configs = serializers.PrimaryKeyRelatedField(queryset=DatabaseConfig.objects.all(), many=True, required=False)

    class Meta:
        model = AccessProfile
        fields = (
            "id",
            "name",
            "description",
            "granted_storage_hosts",
            "granted_databases",
            "granted_database_configs",
        )


class UserSerializer(serializers.ModelSerializer):
    access_profile = serializers.PrimaryKeyRelatedField(queryset=AccessProfile.objects.all(), required=False, allow_null=True)
    granted_storage_hosts = serializers.PrimaryKeyRelatedField(queryset=StorageHost.objects.all(), many=True, required=False)
    granted_databases = serializers.PrimaryKeyRelatedField(queryset=Database.objects.all(), many=True, required=False)
    granted_database_configs = serializers.PrimaryKeyRelatedField(queryset=DatabaseConfig.objects.all(), many=True, required=False)

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "role",
            "is_active",
            "date_joined",
            "access_profile",
            "granted_storage_hosts",
            "granted_databases",
            "granted_database_configs",
        )
        read_only_fields = ("id", "date_joined")


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)
    access_profile = serializers.PrimaryKeyRelatedField(queryset=AccessProfile.objects.all(), required=False, allow_null=True)
    granted_storage_hosts = serializers.PrimaryKeyRelatedField(queryset=StorageHost.objects.all(), many=True, required=False)
    granted_databases = serializers.PrimaryKeyRelatedField(queryset=Database.objects.all(), many=True, required=False)
    granted_database_configs = serializers.PrimaryKeyRelatedField(queryset=DatabaseConfig.objects.all(), many=True, required=False)

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "password",
            "role",
            "access_profile",
            "granted_storage_hosts",
            "granted_databases",
            "granted_database_configs",
        )

    def validate_password(self, value):
        user = User(
            username=self.initial_data.get("username", ""),
            email=self.initial_data.get("email", ""),
        )
        validate_password(value, user=user)
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        granted_storage_hosts = validated_data.pop("granted_storage_hosts", [])
        granted_databases = validated_data.pop("granted_databases", [])
        granted_database_configs = validated_data.pop("granted_database_configs", [])
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        if granted_storage_hosts:
            user.granted_storage_hosts.set(granted_storage_hosts)
        if granted_databases:
            user.granted_databases.set(granted_databases)
        if granted_database_configs:
            user.granted_database_configs.set(granted_database_configs)
        return user
