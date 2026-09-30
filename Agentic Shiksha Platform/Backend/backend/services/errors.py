"""Expected domain rejections, translated to HTTP only by the API layer."""


class InvalidInput(Exception):
    pass


class NotAuthenticated(Exception):
    pass


class AccessDenied(Exception):
    pass


class MissingResource(Exception):
    pass
