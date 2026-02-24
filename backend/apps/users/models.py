from django.contrib.auth.models import AbstractUser, UserManager
from django.db import models


class UserRole(models.TextChoices):
    ADMIN = "ADMIN", "Admin"
    USER = "USER", "User"


class AccessProfile(models.Model):
    name = models.CharField(max_length=120, unique=True)
    description = models.CharField(max_length=255, blank=True, default="")
    granted_storage_hosts = models.ManyToManyField("hosts.StorageHost", blank=True, related_name="access_profiles")
    granted_databases = models.ManyToManyField("hosts.Database", blank=True, related_name="access_profiles")
    granted_database_configs = models.ManyToManyField("hosts.DatabaseConfig", blank=True, related_name="access_profiles")

    class Meta:
        ordering = ("name",)

    def __str__(self):
        return self.name


class DBAutoUserManager(UserManager):
    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault("role", UserRole.ADMIN)
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    role = models.CharField(max_length=16, choices=UserRole.choices, default=UserRole.USER)
    access_profile = models.ForeignKey(
        "users.AccessProfile",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_users",
    )
    granted_storage_hosts = models.ManyToManyField("hosts.StorageHost", blank=True, related_name="granted_users")
    granted_databases = models.ManyToManyField("hosts.Database", blank=True, related_name="granted_users")
    granted_database_configs = models.ManyToManyField("hosts.DatabaseConfig", blank=True, related_name="granted_users")
    objects = DBAutoUserManager()

    @property
    def is_admin(self):
        return self.role == UserRole.ADMIN or self.is_superuser
