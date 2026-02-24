from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("common", "0003_sitesettings_connection_check_interval"),
    ]

    operations = [
        migrations.AddField(
            model_name="sitesettings",
            name="last_connection_check_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="sitesettings",
            name="last_connection_check_payload",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
