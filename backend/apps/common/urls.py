from django.urls import path

from .views import ResetThrottlesView, SiteSettingsView

urlpatterns = [
    path("", SiteSettingsView.as_view(), name="site-settings"),
    path("reset-throttles/", ResetThrottlesView.as_view(), name="reset-throttles"),
]
