from django.db import migrations


def set_superusers_admin_role(apps, schema_editor):
    User = apps.get_model("users", "User")
    User.objects.filter(is_superuser=True).exclude(role="ADMIN").update(role="ADMIN")


def noop_reverse(apps, schema_editor):
    return


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(set_superusers_admin_role, reverse_code=noop_reverse),
    ]
