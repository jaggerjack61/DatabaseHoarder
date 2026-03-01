from django.db import migrations, models
from django.utils import timezone


def seed_versions(apps, schema_editor):
    DatabaseConfig = apps.get_model("hosts", "DatabaseConfig")
    DatabaseConfigVersion = apps.get_model("hosts", "DatabaseConfigVersion")
    ReplicationPolicy = apps.get_model("hosts", "ReplicationPolicy")
    ReplicationPolicyVersion = apps.get_model("hosts", "ReplicationPolicyVersion")
    RestoreConfig = apps.get_model("hosts", "RestoreConfig")
    RestoreConfigVersion = apps.get_model("hosts", "RestoreConfigVersion")

    for config in DatabaseConfig.objects.all().iterator():
        effective_from = getattr(config, "created_at", None) or timezone.now()
        DatabaseConfigVersion.objects.create(
            database_config_id=config.id,
            database_id=config.database_id,
            backup_frequency_minutes=config.backup_frequency_minutes,
            retention_days=config.retention_days,
            backup_days_of_week=config.backup_days_of_week,
            retention_keep_monthly_first=config.retention_keep_monthly_first,
            retention_keep_weekly_day=config.retention_keep_weekly_day,
            retention_exception_days=config.retention_exception_days,
            retention_exception_max_days=config.retention_exception_max_days,
            enabled=config.enabled,
            effective_from=effective_from,
            effective_to=None,
        )

    for policy in ReplicationPolicy.objects.all().iterator():
        effective_from = getattr(policy, "created_at", None) or timezone.now()
        ReplicationPolicyVersion.objects.create(
            replication_policy_id=policy.id,
            database_config_id=policy.database_config_id,
            storage_host_id=policy.storage_host_id,
            remote_path=policy.remote_path,
            enabled=policy.enabled,
            replication_frequency_minutes=policy.replication_frequency_minutes,
            replication_days_of_week=policy.replication_days_of_week,
            replication_retention_days=policy.replication_retention_days,
            replication_retention_exception_days=policy.replication_retention_exception_days,
            replication_retention_exception_max_days=policy.replication_retention_exception_max_days,
            effective_from=effective_from,
            effective_to=None,
        )

    for restore_config in RestoreConfig.objects.all().iterator():
        effective_from = getattr(restore_config, "created_at", None) or timezone.now()
        RestoreConfigVersion.objects.create(
            restore_config_id=restore_config.id,
            source_config_id=restore_config.source_config_id,
            target_database_id=restore_config.target_database_id,
            restore_frequency_minutes=restore_config.restore_frequency_minutes,
            restore_days_of_week=restore_config.restore_days_of_week,
            drop_target_on_success=restore_config.drop_target_on_success,
            enabled=restore_config.enabled,
            effective_from=effective_from,
            effective_to=None,
        )


class Migration(migrations.Migration):

    dependencies = [
        ("hosts", "0009_add_updated_at_to_configs"),
    ]

    operations = [
        migrations.CreateModel(
            name="DatabaseConfigVersion",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("backup_frequency_minutes", models.PositiveIntegerField(default=60)),
                ("retention_days", models.PositiveIntegerField(default=7)),
                ("backup_days_of_week", models.JSONField(blank=True, default=list)),
                ("retention_keep_monthly_first", models.BooleanField(default=False)),
                ("retention_keep_weekly_day", models.IntegerField(blank=True, null=True)),
                ("retention_exception_days", models.PositiveIntegerField(blank=True, null=True)),
                ("retention_exception_max_days", models.PositiveIntegerField(blank=True, null=True)),
                ("enabled", models.BooleanField(default=True)),
                ("effective_from", models.DateTimeField()),
                ("effective_to", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "database",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="database_config_versions", to="hosts.database"),
                ),
                (
                    "database_config",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="versions", to="hosts.databaseconfig"),
                ),
            ],
            options={"ordering": ("-effective_from", "-id")},
        ),
        migrations.CreateModel(
            name="ReplicationPolicyVersion",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("remote_path", models.CharField(default="/backups", max_length=500)),
                ("enabled", models.BooleanField(default=True)),
                ("replication_frequency_minutes", models.PositiveIntegerField(blank=True, null=True)),
                ("replication_days_of_week", models.JSONField(blank=True, default=list)),
                ("replication_retention_days", models.PositiveIntegerField(blank=True, null=True)),
                ("replication_retention_exception_days", models.PositiveIntegerField(blank=True, null=True)),
                ("replication_retention_exception_max_days", models.PositiveIntegerField(blank=True, null=True)),
                ("effective_from", models.DateTimeField()),
                ("effective_to", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "database_config",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="replication_policy_versions", to="hosts.databaseconfig"),
                ),
                (
                    "replication_policy",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="versions", to="hosts.replicationpolicy"),
                ),
                (
                    "storage_host",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="replication_policy_versions", to="hosts.storagehost"),
                ),
            ],
            options={"ordering": ("-effective_from", "-id")},
        ),
        migrations.CreateModel(
            name="RestoreConfigVersion",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("restore_frequency_minutes", models.PositiveIntegerField(default=1440)),
                ("restore_days_of_week", models.JSONField(blank=True, default=list)),
                ("drop_target_on_success", models.BooleanField(default=False)),
                ("enabled", models.BooleanField(default=True)),
                ("effective_from", models.DateTimeField()),
                ("effective_to", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "restore_config",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="versions", to="hosts.restoreconfig"),
                ),
                (
                    "source_config",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="restore_config_versions", to="hosts.databaseconfig"),
                ),
                (
                    "target_database",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="restore_config_versions", to="hosts.database"),
                ),
            ],
            options={"ordering": ("-effective_from", "-id")},
        ),
        migrations.RunPython(seed_versions, migrations.RunPython.noop),
    ]
