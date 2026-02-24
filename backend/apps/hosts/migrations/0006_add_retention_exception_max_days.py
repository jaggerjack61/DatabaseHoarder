from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hosts", "0005_add_interval_schedule_retention_exceptions"),
    ]

    operations = [
        migrations.AddField(
            model_name="databaseconfig",
            name="retention_exception_max_days",
            field=models.PositiveIntegerField(blank=True, null=True, help_text="Stop retention exceptions after this many days."),
        ),
        migrations.AddField(
            model_name="replicationpolicy",
            name="replication_retention_exception_max_days",
            field=models.PositiveIntegerField(blank=True, null=True, help_text="Stop replication retention exceptions after this many days."),
        ),
    ]
