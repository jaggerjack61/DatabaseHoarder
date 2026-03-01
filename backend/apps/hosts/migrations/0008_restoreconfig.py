from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hosts", "0007_alter_database_name"),
    ]

    operations = [
        migrations.CreateModel(
            name="RestoreConfig",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("restore_frequency_minutes", models.PositiveIntegerField(default=1440)),
                (
                    "restore_days_of_week",
                    models.JSONField(
                        blank=True,
                        default=list,
                        help_text="Weekday numbers to run restores on (0=Mon … 6=Sun). Empty list means every day.",
                    ),
                ),
                (
                    "drop_target_on_success",
                    models.BooleanField(
                        default=False,
                        help_text="Drop/remove the restored target after a successful restore (testing mode).",
                    ),
                ),
                (
                    "last_restored_at",
                    models.DateTimeField(
                        blank=True,
                        help_text="Set by the scheduler when a restore run is enqueued.",
                        null=True,
                    ),
                ),
                ("enabled", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "source_config",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="restore_configs", to="hosts.databaseconfig"),
                ),
                (
                    "target_database",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="restore_targets", to="hosts.database"),
                ),
            ],
            options={
                "ordering": ("-created_at",),
            },
        ),
    ]
