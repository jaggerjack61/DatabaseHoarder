from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse

HEALTHY_STATUS = "ok"
DEGRADED_STATUS = "degraded"
FAILED_STATUS = "error"


def _database_status() -> str:
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        cursor.fetchone()
    return HEALTHY_STATUS


def _cache_status() -> str:
    cache.get("healthcheck")
    return HEALTHY_STATUS


def health_view(_request):
    checks = {}

    for name, check in (("database", _database_status), ("cache", _cache_status)):
        try:
            checks[name] = check()
        except Exception:
            checks[name] = FAILED_STATUS

    is_healthy = all(result == HEALTHY_STATUS for result in checks.values())
    payload = {
        "status": HEALTHY_STATUS if is_healthy else DEGRADED_STATUS,
        "checks": checks,
    }
    return JsonResponse(payload, status=200 if is_healthy else 503)