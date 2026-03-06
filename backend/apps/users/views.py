from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import password_validators_help_texts, validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.decorators import action
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import AccessProfile
from .permissions import IsAdminRole
from .serializers import AccessProfileSerializer, UserCreateSerializer, UserSerializer

User = get_user_model()


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.prefetch_related(
        "access_profiles",
        "access_profiles__granted_storage_hosts",
        "access_profiles__granted_databases",
        "access_profiles__granted_database_configs",
        "access_profiles__granted_replication_policies",
        "access_profiles__granted_restore_configs",
    ).all().order_by("id")

    def get_permissions(self):
        if self.action in ("me", "change_password"):
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsAdminRole()]

    def get_serializer_class(self):
        if self.action == "create":
            return UserCreateSerializer
        return UserSerializer

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def me(self, request):
        serializer = UserSerializer(request.user)
        return Response(serializer.data)

    @action(detail=False, methods=["post"], permission_classes=[IsAuthenticated], url_path="change-password")
    def change_password(self, request):
        user = request.user
        old_password = request.data.get("old_password", "")
        new_password = request.data.get("new_password", "")

        if not user.check_password(old_password):
            return Response(
                {"detail": "Current password is incorrect."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            validate_password(new_password, user=user)
        except DjangoValidationError as exc:
            return Response(
                {"detail": " ".join(exc.messages)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_password)
        user.save()
        return Response({"detail": "Password updated successfully."})

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated], url_path="password-rules")
    def password_rules(self, request):
        return Response({"rules": password_validators_help_texts()})


class AccessProfileViewSet(viewsets.ModelViewSet):
    queryset = AccessProfile.objects.prefetch_related(
        "granted_storage_hosts",
        "granted_databases",
        "granted_database_configs",
        "granted_replication_policies",
        "granted_restore_configs",
    ).all()
    serializer_class = AccessProfileSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]
