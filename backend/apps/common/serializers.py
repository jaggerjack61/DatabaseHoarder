from rest_framework import serializers

from .models import SiteSettings


class SiteSettingsSerializer(serializers.ModelSerializer):
    def validate_backup_execution_mode(self, value: str) -> str:
        normalized = (value or "").strip().lower()
        allowed = {
            SiteSettings.BACKUP_MODE_PYTHON,
            SiteSettings.BACKUP_MODE_NATIVE,
            SiteSettings.BACKUP_MODE_AUTO,
        }
        if normalized not in allowed:
            raise serializers.ValidationError("backup_execution_mode must be one of: python, native, auto.")
        return normalized

    class Meta:
        model = SiteSettings
        fields = ("restore_throttle_rate", "manual_backup_throttle_rate", "backup_execution_mode")
