from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("common", "0002_sitesettings_backup_execution_mode"),
    ]

    operations = [
        migrations.AddField(
            model_name="sitesettings",
            name="connection_check_interval_seconds",
            field=models.PositiveIntegerField(default=300, help_text="Interval in seconds for connection health checks."),
        ),
    ]
