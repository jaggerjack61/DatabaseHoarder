from rest_framework.routers import DefaultRouter

from .views import DatabaseConfigViewSet, DatabaseViewSet, ReplicationPolicyViewSet, StorageHostViewSet

router = DefaultRouter()
router.register("storage-hosts", StorageHostViewSet, basename="storage-hosts")
router.register("databases", DatabaseViewSet, basename="databases")
router.register("configs", DatabaseConfigViewSet, basename="configs")
router.register("replication-policies", ReplicationPolicyViewSet, basename="replication-policies")

urlpatterns = router.urls
