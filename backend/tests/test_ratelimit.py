from app.sync.ratelimit import RateLimiter


class Clock:
    def __init__(self, now: float) -> None:
        self.now = now
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, s: float) -> None:
        self.slept.append(s)
        self.now += s


def strava(clock: Clock) -> RateLimiter:
    return RateLimiter([900, 86400], clock=clock, sleep=clock.sleep)


def test_no_wait_under_quota() -> None:
    clock = Clock(1_000_000_000.0)
    rl = strava(clock)
    rl.update({"X-RateLimit-Limit": "100,1000", "X-RateLimit-Usage": "10,200"})
    assert rl.delay() == 0


def test_waits_until_short_window_resets() -> None:
    clock = Clock(900 * 1000 + 100.0)  # 100 s après le début d'une fenêtre de 15 min
    rl = strava(clock)
    rl.update({"x-ratelimit-limit": "100,1000", "x-ratelimit-usage": "100,200"})
    assert rl.delay() == 800
    rl.acquire()
    assert clock.slept == [800]
    assert rl.delay() == 0  # nouvelle fenêtre : l'usage mesuré est périmé


def test_daily_window_dominates() -> None:
    clock = Clock(86400 * 20000 + 80000.0)
    rl = strava(clock)
    rl.update({"X-RateLimit-Limit": "100,1000", "X-RateLimit-Usage": "5,1000"})
    assert rl.delay() == 6400


def test_margin_and_retry_after() -> None:
    clock = Clock(900 * 1000 + 10.0)
    rl = RateLimiter([900], margin=5, clock=clock, sleep=clock.sleep)
    rl.update({"X-RateLimit-Limit": "100", "X-RateLimit-Usage": "95", "Retry-After": "30"})
    assert rl.delay() == 890  # marge atteinte
    rl2 = RateLimiter([900], clock=clock, sleep=clock.sleep)
    rl2.update({"Retry-After": "30"})
    assert rl2.delay() == 30


def test_garbage_headers_ignored() -> None:
    clock = Clock(1000.0)
    rl = strava(clock)
    rl.update({"X-RateLimit-Limit": "abc", "X-RateLimit-Usage": ""})
    assert rl.delay() == 0
