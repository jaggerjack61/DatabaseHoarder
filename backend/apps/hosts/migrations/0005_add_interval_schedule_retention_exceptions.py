from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hosts", "0004_add_database_alias"),
    ]

    operations = [
        migrations.AddField(
            model_name="databaseconfig",
            name="retention_exception_days",
            field=models.PositiveIntegerField(blank=True, null=True, help_text="Keep one backup every N days beyond the standard retention window."),
        ),
        migrations.AddField(
            model_name="replicationpolicy",
            name="replication_days_of_week",
            field=models.JSONField(blank=True, default=list, help_text="Weekday numbers to run replications on (0=Mon … 6=Sun). Empty list means every day."),
        ),
        migrations.AddField(
            model_name="replicationpolicy",
            name="replication_retention_exception_days",
            field=models.PositiveIntegerField(blank=True, null=True, help_text="Keep one replicated copy every N days beyond retention."),
        ),
    ]
