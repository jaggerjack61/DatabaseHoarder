from django.db import migrations, models


def populate_database_alias(apps, schema_editor):
    Database = apps.get_model("hosts", "Database")
    for db in Database.objects.filter(alias=""):
        db.alias = db.name
        db.save(update_fields=["alias"])


class Migration(migrations.Migration):

    dependencies = [
        ("hosts", "0003_add_sqlite_remote_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="database",
            name="alias",
            field=models.CharField(blank=True, default="", max_length=120, help_text="Display label for this database"),
        ),
        migrations.RunPython(populate_database_alias, migrations.RunPython.noop),
    ]
