from django.contrib import admin

from .models import Backup, BackupReplication


@admin.register(Backup)
class BackupAdmin(admin.ModelAdmin):
    list_display = ("id", "database_config", "status", "file_size", "started_at", "completed_at")
    list_filter = ("status",)


@admin.register(BackupReplication)
class BackupReplicationAdmin(admin.ModelAdmin):
    list_display = ("id", "backup", "storage_host", "status", "started_at", "completed_at")
    list_filter = ("status",)
