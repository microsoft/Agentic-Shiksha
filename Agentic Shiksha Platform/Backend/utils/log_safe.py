"""Sanitizer for values interpolated into log messages."""


def scrub(value: object) -> str:
    """Return ``value`` as text with line breaks removed.

    User-controlled data reaches many log statements. A newline in it would start a
    fresh, attacker-authored line in the log, which can forge entries or hide activity.
    """
    return str(value).replace("\r", "").replace("\n", "")
