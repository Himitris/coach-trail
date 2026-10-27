import json
import logging

import pytest

from app.logging import REDACTED, JsonFormatter, SecretMaskingFilter


def _render(msg: str, *args: object, secrets: list[str] | None = None) -> str:
    record = logging.LogRecord("t", logging.INFO, __file__, 1, msg, args or None, None)
    SecretMaskingFilter(secrets).filter(record)
    message: str = json.loads(JsonFormatter().format(record))["message"]
    return message


@pytest.mark.parametrize(
    "line,leaked",
    [
        ("login password=hunter2 ok", "hunter2"),
        ("api_key: abcd1234efgh", "abcd1234efgh"),
        ('{"access_token": "tok-123456"}', "tok-123456"),
        ("Authorization: Bearer eyJhbGciOi.xyz", "eyJhbGciOi"),
        ("OVH_CONSUMER_KEY=zzzz9999 start", "zzzz9999"),
        ("client_secret=s3cr3t&code=1", "s3cr3t"),
    ],
)
def test_masks_sensitive_keys(line: str, leaked: str) -> None:
    out = _render(line)
    assert leaked not in out
    assert REDACTED in out


def test_masks_args_and_known_values() -> None:
    out = _render("appel avec %s", "valeur-secrete-42", secrets=["valeur-secrete-42"])
    assert "valeur-secrete-42" not in out


def test_harmless_message_untouched() -> None:
    assert _render("sync terminée: 12 activités") == "sync terminée: 12 activités"


def test_masks_exception_text() -> None:
    try:
        raise RuntimeError("échec password=hunter2")
    except RuntimeError:
        import sys

        record = logging.LogRecord("t", logging.ERROR, __file__, 1, "err", None, sys.exc_info())
    SecretMaskingFilter().filter(record)
    assert "hunter2" not in JsonFormatter().format(record)
