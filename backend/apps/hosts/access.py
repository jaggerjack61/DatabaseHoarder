from django.db.models import Q

from .models import Database, DatabaseConfig, StorageHost


def accessible_storage_hosts_for_user(user):
    if user.is_admin:
        return StorageHost.objects.all()
    return StorageHost.objects.filter(
        Q(owner=user) | Q(granted_users=user) | Q(access_profiles__assigned_users=user)
    ).distinct()


def accessible_databases_for_user(user):
    if user.is_admin:
        return Database.objects.all()
    return Database.objects.filter(
        Q(owner=user) | Q(granted_users=user) | Q(access_profiles__assigned_users=user)
    ).distinct()


def accessible_configs_for_user(user):
    if user.is_admin:
        return DatabaseConfig.objects.all()
    return DatabaseConfig.objects.filter(
        Q(database__owner=user)
        | Q(granted_users=user)
        | Q(database__granted_users=user)
        | Q(access_profiles__assigned_users=user)
        | Q(database__access_profiles__assigned_users=user)
    ).distinct()
