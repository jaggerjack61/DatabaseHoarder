from django.test import TestCase, override_settings


TEST_CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "health-tests",
    }
}


@override_settings(CACHES=TEST_CACHES)
class HealthCheckTests(TestCase):
    def test_health_endpoint_is_public_and_reports_ok(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": "ok",
                "checks": {
                    "database": "ok",
                    "cache": "ok",
                },
            },
        )