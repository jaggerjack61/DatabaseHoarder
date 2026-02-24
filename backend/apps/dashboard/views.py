from django.core.cache import cache
from django.db.models import Count
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.backups.models import Backup, BackupStatus


class DashboardMetricsView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        user = request.user
        cache_key = f"dashboard_metrics_{user.id}_{user.role}"
        cached = cache.get(cache_key)
        if cached:
            return Response(cached)

        base = Backup.objects.select_related("database_config__database")
        if not user.is_admin:
            base = base.filter(database_config__database__owner=user)

        largest = [
            {
                "database_config_id": item.database_config_id,
                "database": item.database_config.database.name,
                "size": item.file_size,
            }
            for item in base.filter(status=BackupStatus.SUCCESS).order_by("-file_size")[:10]
        ]

        most_backed_up = list(
            base.values("database_config_id", "database_config__database__name")
            .annotate(total=Count("id"))
            .order_by("-total")[:10]
        )

        last_two = (
            base.filter(status=BackupStatus.SUCCESS)
            .order_by("database_config_id", "-completed_at")
            .values("database_config_id", "file_size")
        )
        growth_map: dict[int, list[int]] = {}
        for item in last_two:
            key = item["database_config_id"]
            growth_map.setdefault(key, []).append(item["file_size"])

        growth = []
        for db_id, sizes in growth_map.items():
            if len(sizes) >= 2:
                growth.append({"database_config_id": db_id, "delta": sizes[0] - sizes[1]})
        growth = sorted(growth, key=lambda entry: entry["delta"], reverse=True)[:10]

        total_count = base.count()
        failed_count = base.filter(status=BackupStatus.FAILED).count()
        failure_rate = (failed_count / total_count * 100) if total_count else 0

        payload = {
            "largest_databases": largest,
            "most_backed_up_databases": most_backed_up,
            "largest_growth": growth,
            "failure_rate": round(failure_rate, 2),
        }
        cache.set(cache_key, payload, timeout=120)
        return Response(payload)
