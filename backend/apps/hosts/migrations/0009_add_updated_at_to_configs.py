from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hosts", "0008_restoreconfig"),
    ]

    operations = [
        migrations.AddField(
            model_name="databaseconfig",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AddField(
            model_name="replicationpolicy",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AddField(
            model_name="restoreconfig",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
    ]
