import time
from collections.abc import Callable, Mapping, Sequence


class RateLimiter:
    """Limiteur générique alimenté par des en-têtes de quota (ex. Strava).

    `windows_s` : durée de chaque fenêtre, dans l'ordre des valeurs des en-têtes
    (Strava : `X-RateLimit-Limit: 100,1000` et `X-RateLimit-Usage: 12,340` pour 900 s et 86400 s).
    Les fenêtres sont alignées sur l'horloge (epoch), comme chez Strava.
    """

    def __init__(
        self,
        windows_s: Sequence[int],
        *,
        limit_header: str = "X-RateLimit-Limit",
        usage_header: str = "X-RateLimit-Usage",
        margin: int = 0,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._windows = list(windows_s)
        self._limit_header = limit_header.lower()
        self._usage_header = usage_header.lower()
        self._margin = margin
        self._clock = clock
        self._sleep = sleep
        self._limits: list[int] = []
        # (usage, index de fenêtre au moment de la mesure)
        self._usage: list[tuple[int, int]] = []
        self._blocked_until = 0.0

    @staticmethod
    def _ints(value: str | None) -> list[int]:
        if not value:
            return []
        try:
            return [int(p) for p in value.split(",")]
        except ValueError:
            return []

    def update(self, headers: Mapping[str, str]) -> None:
        h = {k.lower(): v for k, v in headers.items()}
        now = self._clock()
        limits = self._ints(h.get(self._limit_header))
        usages = self._ints(h.get(self._usage_header))
        if limits:
            self._limits = limits
        if usages:
            self._usage = [(u, int(now // w)) for u, w in zip(usages, self._windows, strict=False)]
        retry_after = h.get("retry-after")
        if retry_after and retry_after.strip().isdigit():
            self._blocked_until = max(self._blocked_until, now + int(retry_after))

    def delay(self) -> float:
        """Secondes à attendre avant le prochain appel (0 si possible tout de suite)."""
        now = self._clock()
        wait = max(0.0, self._blocked_until - now)
        for (usage, idx), limit, w in zip(self._usage, self._limits, self._windows, strict=False):
            if int(now // w) != idx:
                continue  # fenêtre déjà réinitialisée
            if usage + self._margin >= limit:
                wait = max(wait, w - (now % w))
        return wait

    def acquire(self) -> None:
        d = self.delay()
        if d > 0:
            self._sleep(d)
