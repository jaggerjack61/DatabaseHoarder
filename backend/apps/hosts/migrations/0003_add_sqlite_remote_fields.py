from django.db import migrations, models


def populate_sqlite_path(apps, schema_editor):
    Database = apps.get_model("hosts", "Database")
    for db in Database.objects.filter(db_type="SQLITE"):
        if not db.sqlite_path and db.host:
            db.sqlite_path = db.host
            db.save(update_fields=["sqlite_path"])


class Migration(migrations.Migration):

    dependencies = [
        ("hosts", "0002_add_scheduling_retention_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="database",
            name="sqlite_location",
            field=models.CharField(choices=[("LOCAL", "Local"), ("REMOTE", "Remote")], default="LOCAL", max_length=10),
        ),
        migrations.AddField(
            model_name="database",
            name="sqlite_path",
            field=models.CharField(blank=True, default="", max_length=500),
        ),
        migrations.RunPython(populate_sqlite_path, migrations.RunPython.noop),
    ]
