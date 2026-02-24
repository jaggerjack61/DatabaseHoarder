from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="SiteSettings",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("restore_throttle_rate", models.CharField(
                    default="30/hour",
                    help_text="Restore endpoint rate limit, e.g. 30/hour or 10/minute.",
                    max_length=32,
                )),
                ("manual_backup_throttle_rate", models.CharField(
                    default="60/hour",
                    help_text="Manual backup trigger rate limit, e.g. 60/hour.",
                    max_length=32,
                )),
            ],
            options={
                "verbose_name": "Site Settings",
                "verbose_name_plural": "Site Settings",
            },
        ),
    ]
