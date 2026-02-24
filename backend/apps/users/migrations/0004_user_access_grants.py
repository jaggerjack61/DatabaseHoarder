from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hosts", "0002_add_scheduling_retention_fields"),
        ("users", "0003_alter_user_managers"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="granted_database_configs",
            field=models.ManyToManyField(blank=True, related_name="granted_users", to="hosts.databaseconfig"),
        ),
        migrations.AddField(
            model_name="user",
            name="granted_databases",
            field=models.ManyToManyField(blank=True, related_name="granted_users", to="hosts.database"),
        ),
        migrations.AddField(
            model_name="user",
            name="granted_storage_hosts",
            field=models.ManyToManyField(blank=True, related_name="granted_users", to="hosts.storagehost"),
        ),
    ]
