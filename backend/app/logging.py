import json
import logging
import re
from datetime import UTC, datetime
from typing import Any

REDACTED = "***"

_SENSITIVE_KEYS = (
    r"[\w-]*(?:token|secret|password|passwd|mot_de_passe|api[_-]?key|consumer[_-]?key|"
    r"application[_-]?key|authorization|cookie)[\w-]*"
)
# key=value, key: value, "key": "value", Authorization: Bearer xxx
_KV_RE = re.compile(
    rf"""(?P<key>["']?{_SENSITIVE_KEYS}["']?\s*[:=]\s*)(?P<val>(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;&}}\]]+))""",
    re.IGNORECASE,
)


class SecretMaskingFilter(logging.Filter):
    """Masque les secrets (clés/valeurs sensibles et valeurs exactes connues) dans les logs."""

    def __init__(self, secrets: list[str] | None = None) -> None:
        super().__init__()
        self._secrets = [s for s in (secrets or []) if len(s) >= 4]

    def mask(self, text: str) -> str:
        text = _KV_RE.sub(lambda m: f"{m.group('key')}{REDACTED}", text)
        for secret in self._secrets:
            text = text.replace(secret, REDACTED)
        return text

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self.mask(record.getMessage())
        record.args = None
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = self.mask(record.exc_text)
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_text:
            payload["exc"] = record.exc_text
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(secrets: list[str] | None = None, level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    handler.addFilter(SecretMaskingFilter(secrets))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
