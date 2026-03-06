from django.db.models import Q

from .models import Database, DatabaseConfig, ReplicationPolicy, RestoreConfig, StorageHost


def accessible_storage_hosts_for_user(user):
    if user.is_admin:
        return StorageHost.objects.all()
    return StorageHost.objects.filter(
        Q(owner=user) | Q(access_profiles__assigned_users=user)
    ).distinct()


def accessible_databases_for_user(user):
    if user.is_admin:
        return Database.objects.all()
    return Database.objects.filter(
        Q(owner=user) | Q(access_profiles__assigned_users=user)
    ).distinct()


def accessible_configs_for_user(user):
    if user.is_admin:
        return DatabaseConfig.objects.all()
    return DatabaseConfig.objects.filter(
        Q(database__owner=user)
        | Q(access_profiles__assigned_users=user)
        | Q(database__access_profiles__assigned_users=user)
    ).distinct()


def accessible_replication_policies_for_user(user):
    if user.is_admin:
        return ReplicationPolicy.objects.all()
    return ReplicationPolicy.objects.filter(
        Q(access_profiles__assigned_users=user)
        | Q(database_config__access_profiles__assigned_users=user)
        | Q(storage_host__access_profiles__assigned_users=user)
        | Q(database_config__database__owner=user)
    ).distinct()


def accessible_restore_configs_for_user(user):
    if user.is_admin:
        return RestoreConfig.objects.all()
    return RestoreConfig.objects.filter(
        Q(access_profiles__assigned_users=user)
        | Q(source_config__access_profiles__assigned_users=user)
        | Q(target_database__access_profiles__assigned_users=user)
        | Q(source_config__database__owner=user)
    ).distinct()
