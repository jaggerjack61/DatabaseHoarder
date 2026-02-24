from django.db import models


class SiteSettings(models.Model):
    """
    Application-wide configurable settings (singleton — always pk=1).
    Use SiteSettings.get() to read; never create more than one row.
    """

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
