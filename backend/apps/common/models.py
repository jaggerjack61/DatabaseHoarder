from django.db import models


class SiteSettings(models.Model):
    """
    Application-wide configurable settings (singleton — always pk=1).
    Use SiteSettings.get() to read; never create more than one row.
    """

    BACKUP_MODE_PYTHON = "python"
    BACKUP_MODE_NATIVE = "native"
    BACKUP_MODE_AUTO = "auto"
    BACKUP_MODE_CHOICES = (
        (BACKUP_MODE_PYTHON, "Python Modules"),
        (BACKUP_MODE_NATIVE, "Native CLI"),
        (BACKUP_MODE_AUTO, "Auto (Prefer Native)"),
    )

    restore_throttle_rate = models.CharField(
        max_length=32,
        default="30/hour",
        help_text="Restore endpoint rate limit, e.g. 30/hour or 10/minute.",
    )
    manual_backup_throttle_rate = models.CharField(
        max_length=32,
        default="60/hour",
        help_text="Manual backup trigger rate limit, e.g. 60/hour.",
    )
    backup_execution_mode = models.CharField(
        max_length=16,
        choices=BACKUP_MODE_CHOICES,
        default=BACKUP_MODE_AUTO,
        help_text="Backup engine mode: python, native, or auto.",
    )

    class Meta:
        verbose_name = "Site Settings"
        verbose_name_plural = "Site Settings"

    def __str__(self):
        return "Site Settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get(cls) -> "SiteSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
