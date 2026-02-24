import redis
import os

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.permissions import IsAdminRole

from .models import SiteSettings
from .serializers import SiteSettingsSerializer


class SiteSettingsView(APIView):
    """
    GET  /api/settings/        — return current site settings (admin only)
    PATCH /api/settings/       — update site settings (admin only)
    """

    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request):
        settings = SiteSettings.get()
        serializer = SiteSettingsSerializer(settings)
        return Response(serializer.data)

    def patch(self, request):
        settings = SiteSettings.get()
        serializer = SiteSettingsSerializer(settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ResetThrottlesView(APIView):
    """POST /api/settings/reset-throttles/ — clear all throttle counters (admin only)."""

    permission_classes = [IsAuthenticated, IsAdminRole]

    def post(self, request):
        try:
            r = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
            keys = r.keys("*throttle*")
            if keys:
                r.delete(*keys)
            return Response({"cleared": len(keys)})
        except Exception as exc:
            return Response(
                {"detail": f"Failed to clear throttle counters: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
