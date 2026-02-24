from django.contrib import admin
from django.urls import include, path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/users/", include("apps.users.urls")),
    path("api/hosts/", include("apps.hosts.urls")),
    path("api/backups/", include("apps.backups.urls")),
    path("api/dashboard/", include("apps.dashboard.urls")),
    path("api/settings/", include("apps.common.urls")),
]
