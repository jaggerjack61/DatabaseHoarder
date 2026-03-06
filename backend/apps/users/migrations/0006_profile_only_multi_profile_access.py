from django.db import migrations, models


def migrate_user_access_to_profiles(apps, schema_editor):
    User = apps.get_model("users", "User")
    AccessProfile = apps.get_model("users", "AccessProfile")

    for user in User.objects.all():
        profile_ids = set()

        access_profile_id = getattr(user, "access_profile_id", None)
        if access_profile_id:
            profile_ids.add(access_profile_id)

        direct_hosts = list(user.granted_storage_hosts.all())
        direct_databases = list(user.granted_databases.all())
        direct_configs = list(user.granted_database_configs.all())

        if direct_hosts or direct_databases or direct_configs:
            legacy_name = f"legacy-user-{user.id}-direct"
            legacy_profile, _ = AccessProfile.objects.get_or_create(
                name=legacy_name,
                defaults={"description": f"Migrated direct grants for user {user.username}"},
            )
            if direct_hosts:
                legacy_profile.granted_storage_hosts.set(direct_hosts)
            if direct_databases:
                legacy_profile.granted_databases.set(direct_databases)
            if direct_configs:
                legacy_profile.granted_database_configs.set(direct_configs)
            profile_ids.add(legacy_profile.id)

        if profile_ids:
            user.access_profiles.set(profile_ids)


def reverse_migration_noop(apps, schema_editor):
    # Reverse path intentionally keeps profile-only assignments.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("hosts", "0002_add_scheduling_retention_fields"),
        ("users", "0005_access_profiles"),
    ]

    operations = [
        migrations.AddField(
            model_name="accessprofile",
            name="granted_replication_policies",
            field=models.ManyToManyField(blank=True, related_name="access_profiles", to="hosts.replicationpolicy"),
        ),
        migrations.AddField(
            model_name="accessprofile",
            name="granted_restore_configs",
            field=models.ManyToManyField(blank=True, related_name="access_profiles", to="hosts.restoreconfig"),
        ),
        migrations.AddField(
            model_name="user",
            name="access_profiles",
            field=models.ManyToManyField(blank=True, related_name="assigned_users", to="users.accessprofile"),
        ),
        migrations.RunPython(migrate_user_access_to_profiles, reverse_migration_noop),
        migrations.RemoveField(
            model_name="user",
            name="access_profile",
        ),
        migrations.RemoveField(
            model_name="user",
            name="granted_database_configs",
        ),
        migrations.RemoveField(
            model_name="user",
            name="granted_databases",
        ),
        migrations.RemoveField(
            model_name="user",
            name="granted_storage_hosts",
        ),
    ]
