from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):

    dependencies = [
        ("hosts", "0011_fix_initial_version_effective_from"),
    ]

    operations = [
        migrations.AddField(
            model_name="databaseconfig",
            name="is_one_time_event",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="replicationpolicy",
            name="is_one_time_event",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="restoreconfig",
            name="is_one_time_event",
            field=models.BooleanField(default=False),
        ),
        migrations.AlterUniqueTogether(
            name="replicationpolicy",
            unique_together=set(),
        ),
        migrations.AddConstraint(
            model_name="replicationpolicy",
            constraint=models.UniqueConstraint(
                condition=Q(is_one_time_event=False),
                fields=("database_config", "storage_host"),
                name="uniq_regular_replication_policy_per_target",
            ),
        ),
    ]
