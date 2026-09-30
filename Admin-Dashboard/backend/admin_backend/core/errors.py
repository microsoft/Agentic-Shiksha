class InvalidOperation(ValueError):
    """An admin operation failed its existing input or state checks."""


class ResourceNotFound(LookupError):
    """The requested admin resource does not exist."""
