from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("common", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="sitesettings",
            name="backup_execution_mode",
            field=models.CharField(
                choices=[
                    ("python", "Python Modules"),
                    ("native", "Native CLI"),
                    ("auto", "Auto (Prefer Native)"),
                ],
                default="auto",
                help_text="Backup engine mode: python, native, or auto.",
                max_length=16,
            ),
        ),
    ]
