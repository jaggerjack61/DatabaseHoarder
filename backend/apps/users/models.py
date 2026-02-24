from django.contrib.auth.models import AbstractUser, UserManager
from django.db import models


class UserRole(models.TextChoices):
    ADMIN = "ADMIN", "Admin"
    USER = "USER", "User"


class DBAutoUserManager(UserManager):
    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault("role", UserRole.ADMIN)
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    role = models.CharField(max_length=16, choices=UserRole.choices, default=UserRole.USER)
    objects = DBAutoUserManager()

    @property
    def is_admin(self):
        return self.role == UserRole.ADMIN or self.is_superuser
