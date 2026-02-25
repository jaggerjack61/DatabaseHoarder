from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("common", "0002_sitesettings_backup_execution_mode"),
    ]

    operations = [
        migrations.AddField(
            model_name="sitesettings",
            name="default_replication_path",
            field=models.CharField(
                default="/var/www/backups",
                help_text="Default base path for replication targets.",
                max_length=500,
            ),
        ),
    ]
