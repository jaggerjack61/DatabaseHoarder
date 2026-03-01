from django.db import migrations


def fix_initial_effective_from(apps, schema_editor):
    DatabaseConfig = apps.get_model("hosts", "DatabaseConfig")
    DatabaseConfigVersion = apps.get_model("hosts", "DatabaseConfigVersion")
    ReplicationPolicy = apps.get_model("hosts", "ReplicationPolicy")
    ReplicationPolicyVersion = apps.get_model("hosts", "ReplicationPolicyVersion")
    RestoreConfig = apps.get_model("hosts", "RestoreConfig")
    RestoreConfigVersion = apps.get_model("hosts", "RestoreConfigVersion")

    for config in DatabaseConfig.objects.all().iterator():
        first_version = (
            DatabaseConfigVersion.objects.filter(database_config_id=config.id)
            .order_by("effective_from", "id")
            .first()
        )
        if first_version is not None and config.created_at and first_version.effective_from > config.created_at:
            first_version.effective_from = config.created_at
            first_version.save(update_fields=["effective_from"])

    for policy in ReplicationPolicy.objects.all().iterator():
        first_version = (
            ReplicationPolicyVersion.objects.filter(replication_policy_id=policy.id)
            .order_by("effective_from", "id")
            .first()
        )
        if first_version is not None and policy.created_at and first_version.effective_from > policy.created_at:
            first_version.effective_from = policy.created_at
            first_version.save(update_fields=["effective_from"])

    for restore_config in RestoreConfig.objects.all().iterator():
        first_version = (
            RestoreConfigVersion.objects.filter(restore_config_id=restore_config.id)
            .order_by("effective_from", "id")
            .first()
        )
        if first_version is not None and restore_config.created_at and first_version.effective_from > restore_config.created_at:
            first_version.effective_from = restore_config.created_at
            first_version.save(update_fields=["effective_from"])


class Migration(migrations.Migration):

    dependencies = [
        ("hosts", "0010_add_config_versioning"),
    ]

    operations = [
        migrations.RunPython(fix_initial_effective_from, migrations.RunPython.noop),
    ]
