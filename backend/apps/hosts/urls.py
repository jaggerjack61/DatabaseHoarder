from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ConnectionStatusView,
    DatabaseConfigViewSet,
    DatabaseConfigVersionViewSet,
    DatabaseViewSet,
    ReplicationPolicyViewSet,
    ReplicationPolicyVersionViewSet,
    RestoreConfigViewSet,
    RestoreConfigVersionViewSet,
    StorageHostViewSet,
)

router = DefaultRouter()
router.register("storage-hosts", StorageHostViewSet, basename="storage-hosts")
router.register("databases", DatabaseViewSet, basename="databases")
router.register("configs", DatabaseConfigViewSet, basename="configs")
router.register("config-versions", DatabaseConfigVersionViewSet, basename="config-versions")
router.register("restore-configs", RestoreConfigViewSet, basename="restore-configs")
router.register("restore-config-versions", RestoreConfigVersionViewSet, basename="restore-config-versions")
router.register("replication-policies", ReplicationPolicyViewSet, basename="replication-policies")
router.register("replication-policy-versions", ReplicationPolicyVersionViewSet, basename="replication-policy-versions")

urlpatterns = [
    path("connections/status/", ConnectionStatusView.as_view(), name="connections-status"),
]
urlpatterns += router.urls
