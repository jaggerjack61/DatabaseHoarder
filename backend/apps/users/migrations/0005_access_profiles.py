from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hosts", "0002_add_scheduling_retention_fields"),
        ("users", "0004_user_access_grants"),
    ]

    operations = [
        migrations.CreateModel(
            name="AccessProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120, unique=True)),
                ("description", models.CharField(blank=True, default="", max_length=255)),
                (
                    "granted_database_configs",
                    models.ManyToManyField(blank=True, related_name="access_profiles", to="hosts.databaseconfig"),
                ),
                ("granted_databases", models.ManyToManyField(blank=True, related_name="access_profiles", to="hosts.database")),
                (
                    "granted_storage_hosts",
                    models.ManyToManyField(blank=True, related_name="access_profiles", to="hosts.storagehost"),
                ),
            ],
            options={"ordering": ("name",)},
        ),
        migrations.AddField(
            model_name="user",
            name="access_profile",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.SET_NULL,
                related_name="assigned_users",
                to="users.accessprofile",
            ),
        ),
    ]
