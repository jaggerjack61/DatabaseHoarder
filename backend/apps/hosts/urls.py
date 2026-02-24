from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ConnectionStatusView, DatabaseConfigViewSet, DatabaseViewSet, ReplicationPolicyViewSet, StorageHostViewSet

router = DefaultRouter()
router.register("storage-hosts", StorageHostViewSet, basename="storage-hosts")
router.register("databases", DatabaseViewSet, basename="databases")
router.register("configs", DatabaseConfigViewSet, basename="configs")
router.register("replication-policies", ReplicationPolicyViewSet, basename="replication-policies")

urlpatterns = [
    path("connections/status/", ConnectionStatusView.as_view(), name="connections-status"),
]
urlpatterns += router.urls
