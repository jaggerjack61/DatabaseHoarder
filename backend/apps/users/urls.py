from rest_framework.routers import DefaultRouter

from .views import AccessProfileViewSet, UserViewSet

router = DefaultRouter()
router.register("access-profiles", AccessProfileViewSet, basename="access-profiles")
router.register("", UserViewSet, basename="users")

urlpatterns = router.urls
