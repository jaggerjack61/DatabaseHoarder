from .models import AuditLog


def create_audit_log(*, user, action: str, target: str, metadata: dict | None = None):
    AuditLog.objects.create(
        user=user if getattr(user, "is_authenticated", False) else None,
        action=action,
        target=target,
        metadata=metadata or {},
    )
