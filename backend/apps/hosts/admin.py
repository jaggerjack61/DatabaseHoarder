from django.contrib import admin

from .models import Database, DatabaseConfig, ReplicationPolicy, StorageHost


@admin.register(StorageHost)
class StorageHostAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "address", "ssh_port", "username", "owner", "is_active")


@admin.register(Database)
class DatabaseAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "db_type", "host", "port", "username", "owner", "is_active")


@admin.register(DatabaseConfig)
class DatabaseConfigAdmin(admin.ModelAdmin):
    list_display = ("id", "database", "backup_frequency_minutes", "retention_days", "enabled")


@admin.register(ReplicationPolicy)
class ReplicationPolicyAdmin(admin.ModelAdmin):
    list_display = ("id", "database_config", "storage_host", "remote_path", "enabled")
