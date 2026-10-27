"""Serveur MCP de Coach Trail : accès direct de Claude à vos données, en lecture seule.

Le serveur n'écrit rien et ne touche pas la base : il appelle uniquement des endpoints `GET` de
l'API locale (`ReadApi` n'expose que `get`). Transports : stdio et streamable HTTP (réseau
Tailscale). Verrouillage optionnel par jeton partagé (`MCP_TOKEN`, en-tête `Authorization: Bearer`),
désactivé quand la variable est vide.

    python -m app.mcp_server --transport stdio
    python -m app.mcp_server --transport http --host 0.0.0.0 --port 8765
"""

import argparse
import hmac
import logging
import sys
from collections.abc import Awaitable, Callable, MutableMapping
from datetime import date, timedelta
from typing import Any, Protocol

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

from app.config import Settings, get_settings
from app.logging import configure_logging

logger = logging.getLogger(__name__)

INSTRUCTIONS = (
    "Données d'entraînement de trail d'une seule personne (Coach Trail). Lecture seule. "
    "Chaque résultat indique son niveau de preuve : « mesure », « indicatif », « non validé » ou "
    "« avis de la montre ». Ne traitez jamais l'ACWR, Training Readiness ou Body Battery comme "
    "des vérités, ni la HRV d'une nuit isolée. Il n'y a pas de score de forme unique."
)
READ_ONLY = ToolAnnotations(
    readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False
)
MAX_ACTIVITIES = 60
MAX_WELLNESS_DAYS = 90


class ReadApi(Protocol):
    """Seule opération disponible : lire. Aucune méthode d'écriture n'existe ici."""

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any: ...


class HttpReadApi:
    def __init__(self, base_url: str, client: Any | None = None) -> None:
        """`client` : tout objet avec `get(url, params=)` renvoyant une réponse httpx (tests)."""
        self._client = client or httpx.Client(base_url=base_url, timeout=60.0)

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        try:
            response = self._client.get(path, params=params)
        except (httpx.HTTPError, OSError) as exc:
            raise ToolError(f"API Coach Trail injoignable ({type(exc).__name__}).") from None
        if response.status_code >= 400:
            try:
                detail = response.json().get("detail")
            except ValueError:
                detail = None
            raise ToolError(
                detail if isinstance(detail, str) else f"Erreur {response.status_code}."
            )
        if response.headers.get("content-type", "").startswith("application/json"):
            return response.json()
        return response.text


# --- mise en forme compacte -----------------------------------------------------------------


def _n(value: Any, digits: int = 0, unit: str = "") -> str:
    if value is None:
        return "—"
    return f"{value:.{digits}f}{unit}"


def _evidence(evidence: dict[str, Any] | None) -> str:
    if not evidence:
        return ""
    labels = {"etabli": "mesure", "indicatif": "indicatif", "non_valide": "non validé",
              "avis_montre": "avis de la montre, non validé"}  # fmt: skip
    return f"preuve : {labels.get(evidence['level'], evidence['level'])} — {evidence['summary']}"


def _iso(value: str | None, name: str, default: date) -> date:
    if not value:
        return default
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ToolError(f"« {name} » doit être une date AAAA-MM-JJ (reçu : {value!r}).") from None


def _period(
    start: str | None, end: str | None, today: date, default_days: int
) -> tuple[date, date]:
    last = _iso(end, "to", today)
    first = _iso(start, "from", last - timedelta(days=default_days - 1))
    if first > last:
        raise ToolError("« from » doit précéder « to ».")
    return first, last


def format_profile(profile: dict[str, Any], goals: list[dict[str, Any]], today: date) -> str:
    zones = ", ".join(
        f"Z{z['zone']} ≥ {z['min_bpm']} bpm" for z in profile.get("zones", []) if "zone" in z
    )
    lines = [
        f"FC max {profile['fc_max']} bpm · FC repos {_n(profile.get('fc_repos'))} · seuil lactique "
        f"{_n(profile.get('seuil_lactique_fc'))} bpm",
        f"Zones : {zones or '—'}",
        "Objectifs :",
    ]
    for g in goals:
        left = (date.fromisoformat(g["date"]) - today).days
        lines.append(
            f"- {g['nom']} le {g['date']} (dans {left} j) · {_n(g.get('distance_km'), 1, ' km')} · "
            f"D+ {_n(g.get('dplus_m'), 0, ' m')} · priorité {g['priorite']}"
        )
    if not goals:
        lines.append("- aucun")
    lines.append("preuve : mesure (profil saisi / repris de la montre)")
    return "\n".join(lines)


def format_week(w: dict[str, Any]) -> str:
    def totals(t: dict[str, Any] | None) -> str:
        if not t:
            return "—"
        return (
            f"{t['time_s'] / 3600:.1f} h · {t['distance_m'] / 1000:.1f} km · D+ {t['gain_m']:.0f} m · "
            f"D− {t['loss_m']:.0f} m · {t['sessions']:g} séance(s)"
        )

    lines = [
        f"Semaine du {w['week_start']} au {w['week_end']}"
        + ("" if w["complete"] else " (en cours)"),
        f"Cette semaine : {totals(w['current'])}",
        f"Semaine précédente : {totals(w['previous'])}",
        f"Moyenne 4 semaines : {totals(w.get('avg_4w'))}",
        f"Variation du temps : {_n(w.get('time_change_vs_previous_pct'), 1, ' %')} vs précédente, "
        f"{_n(w.get('time_change_vs_avg4w_pct'), 1, ' %')} vs moyenne 4 sem. (repère ≈ +10 %, "
        "jamais un prédicteur de blessure)",
    ]
    if w.get("srpe"):
        lines.append(
            f"Charge perçue : {w['srpe']['total_load_au']:.0f} u.a. sur {w['srpe']['entries']} séance(s)"
        )
    lines.append(_evidence(w.get("evidence")))
    return "\n".join(lines)


def format_activities(items: list[dict[str, Any]]) -> str:
    if not items:
        return "Aucune sortie sur la période."
    lines = ["id | date | sport | durée | dist. | D+ | FC moy. | RPE | GAP"]
    for a in items:
        gap = a.get("gap_s_per_km")
        lines.append(
            f"{a['id']} | {a['day']} | {a['sport']}{' (course)' if a['is_race'] else ''} | "
            f"{a['duration_min']:.0f} min | {_n(a.get('distance_km'), 1, ' km')} | "
            f"{_n(a.get('dplus_m'), 0, ' m')} | {_n(a.get('hr_avg'))} | {_n(a.get('rpe'))} | "
            f"{'—' if gap is None else f'{int(gap // 60)}:{int(gap % 60):02d}/km'}"
        )
    lines.append("preuve : mesure (montre) ; GAP : indicatif (modèle de Minetti)")
    return "\n".join(lines)


def format_recovery(rec: dict[str, Any], wellness: dict[str, Any]) -> str:
    def comp(label: str, c: dict[str, Any], unit: str, digits: int = 0) -> str:
        if not c["sufficient"]:
            return f"- {label} : données insuffisantes pour une tendance"
        return (
            f"- {label} : moyenne 7 j {_n(c['recent_mean'], digits, unit)} vs base {rec['baseline_days']} j "
            f"{_n(c['baseline_mean'], digits, unit)} ({_n(c['delta_pct'], 1, ' %')}), tendance {c['trend']['direction']}"
        )

    def prop(label: str, m: dict[str, Any]) -> str:
        return f"- {label} : {_n(m['value'])} ({m['label']})"

    lines = [
        f"Récupération au {rec['date']} (tendances, pas de feu vert/rouge quotidien)",
        comp("HRV nocturne", rec["hrv"], " ms"),
        comp("FC repos", rec["resting_hr"], " bpm"),
        comp("Sommeil (durée)", rec["sleep_duration_h"], " h", 1),
        "Avis de la montre (propriétaires, non validés) :",
        prop("Training Readiness", rec["training_readiness"]),
        prop("Body Battery max", rec["body_battery_max"]),
    ]
    if rec.get("acwr"):
        lines.append(
            f"- ACWR Garmin : {rec['acwr']['value']:.2f} (non validé, aucune alerte n'en est tirée)"
        )
    if rec.get("fallback"):
        lines.append(f"⚠ {rec['fallback']['message']}")
    points = wellness["points"]
    if points:
        lines += ["", "date | HRV nuit | FC repos | sommeil"]
        lines += [
            f"{p['date']} | {_n(p['hrv_nuit'], 0)} | {_n(p['fc_repos'])} | {_n(p['sommeil_duree_h'], 1, ' h')}"
            for p in points
        ]
    lines.append(_evidence(rec["hrv"].get("evidence")))
    return "\n".join(lines)


def format_fitness(r: dict[str, Any]) -> str:
    points = r["points"]
    if not points:
        return "Aucune donnée de charge sur la période.\n" + _evidence(r.get("evidence"))
    step = max(1, len(points) // 12)
    sample = points[::step]
    if sample[-1] is not points[-1]:
        sample.append(points[-1])
    lines = [
        "date | charge | CTL | ATL | TSB",
        *[
            f"{p['date']} | {p['load']:.0f} | {p['ctl']:.1f} | {p['atl']:.1f} | {p['tsb']:+.1f}"
            for p in sample
        ],
        f"Rampe CTL 4 sem. : {_n(r.get('ctl_ramp_4w'), 1)} (tendance {r['trend']['direction']})",
    ]
    lines += [f"note : {w}" for w in r.get("warnings", [])]
    if r.get("reference"):
        lines.append(r["reference"]["note"])
    lines.append(_evidence(r.get("evidence")))
    return "\n".join(lines)


def format_plan(p: dict[str, Any]) -> str:
    lines = [
        f"Semaine du {p['week_start']} : prévu {p['planned_min']} min, réalisé {p['done_min']:.0f} min"
    ]
    for d in p["days"]:
        planned = " + ".join(
            f"{s['planned']['titre']} ({s['planned']['type_label']}"
            f"{', ' + str(s['planned']['duree_min']) + ' min' if s['planned']['duree_min'] else ''}"
            f"{', Z' + s['planned']['zone_cible'] if s['planned']['zone_cible'] else ''}) → {s['status']}"
            for s in d["sessions"]
        )
        extra = (
            " + imprévu : " + ", ".join(a["sport"] for a in d["unplanned_activities"])
            if d["unplanned_activities"]
            else ""
        )
        lines.append(f"- {d['weekday']} {d['date']} : {planned or 'rien de prévu'}{extra}")
    lines.append("preuve : mesure (plan saisi, rapprochement automatique prévu/réalisé)")
    return "\n".join(lines)


# --- serveur --------------------------------------------------------------------------------


def build_server(
    api: ReadApi, today: Callable[[], date] = date.today, *, name: str = "coach-trail"
) -> MCPServer:
    server = MCPServer(name, instructions=INSTRUCTIONS)

    @server.tool(annotations=READ_ONLY)
    def get_profile() -> str:
        """Profil de l'athlète : FC max, zones de FC, seuil, et objectifs de course à venir avec les jours restants."""
        goals = api.get("/api/goals")
        upcoming = [g for g in goals if g["date"] >= today().isoformat()]
        return format_profile(api.get("/api/profile"), upcoming, today())

    @server.tool(annotations=READ_ONLY)
    def get_week_summary(date: str | None = None) -> str:  # noqa: A002
        """Résumé de la semaine (lundi–dimanche) qui contient la date AAAA-MM-JJ (défaut : aujourd'hui) : temps, distance, D+, D−, comparaison à la semaine précédente et à la moyenne 4 semaines."""
        day = _iso(date, "date", today())
        return format_week(api.get("/api/metrics/week", {"date": day.isoformat()}))

    @server.tool(annotations=READ_ONLY)
    def get_activities(from_: str | None = None, to: str | None = None, limit: int = 20) -> str:
        """Sorties dédupliquées entre deux dates AAAA-MM-JJ (défaut : 28 derniers jours), de la plus récente à la plus ancienne : durée, distance, D+, FC moyenne, RPE, allure ajustée à la pente."""
        first, last = _period(from_, to, today(), 28)
        n = min(max(limit, 1), MAX_ACTIVITIES)
        items = api.get(
            "/api/activities", {"from": first.isoformat(), "to": last.isoformat(), "limit": n}
        )
        return format_activities(items)

    @server.tool(annotations=READ_ONLY)
    def get_activity_detail(id: int) -> str:  # noqa: A002
        """Détail d'une sortie (identifiant donné par get_activities) : indicateurs, temps par zone de FC, côtes détectées, allure ajustée à la pente."""
        return str(api.get(f"/api/export/activity/{int(id)}"))

    @server.tool(annotations=READ_ONLY)
    def get_recovery(from_: str | None = None, to: str | None = None) -> str:
        """Récupération sur la période (défaut : 14 derniers jours) : HRV, FC repos et sommeil en moyenne 7 j face à la base personnelle, avis de la montre étiquetés, valeurs quotidiennes. Lire en tendance."""
        first, last = _period(from_, to, today(), 14)
        days = min((last - first).days + 1, MAX_WELLNESS_DAYS)
        rec = api.get("/api/metrics/recovery", {"date": last.isoformat()})
        wellness = api.get(
            "/api/metrics/wellness", {"days": max(days, 7), "date": last.isoformat()}
        )
        wellness["points"] = [
            p for p in wellness["points"] if first.isoformat() <= p["date"] <= last.isoformat()
        ]
        return format_recovery(rec, wellness)

    @server.tool(annotations=READ_ONLY)
    def get_fitness(from_: str | None = None, to: str | None = None) -> str:
        """Charge d'entraînement CTL / ATL / TSB entre deux dates (défaut : 90 jours) : courbes de tendance (constantes 42 j / 7 j), jamais un verdict de forme."""
        first, last = _period(from_, to, today(), 90)
        return format_fitness(
            api.get("/api/metrics/fitness", {"from": first.isoformat(), "to": last.isoformat()})
        )

    @server.tool(annotations=READ_ONLY)
    def get_plan(week: str | None = None) -> str:
        """Programme de la semaine qui contient la date AAAA-MM-JJ (défaut : cette semaine) : séances prévues, statut (fait, manqué, partiel…) et séances imprévues."""
        day = _iso(week, "week", today())
        return format_plan(api.get("/api/plan/week", {"date": day.isoformat()}))

    @server.tool(annotations=READ_ONLY)
    def export_markdown(from_: str | None = None, to: str | None = None) -> str:
        """Export complet en Markdown (le même que « Copier pour Claude ») : profil, volume, intensités, séances, plan, récupération, glossaire des niveaux de preuve, limites. Défaut : 28 derniers jours."""
        first, last = _period(from_, to, today(), 28)
        return str(
            api.get(
                "/api/export", {"from": first.isoformat(), "to": last.isoformat(), "format": "md"}
            )
        )

    return server


# --- verrouillage par jeton -----------------------------------------------------------------

Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]


class BearerTokenMiddleware:
    """Refuse (401) toute requête HTTP sans `Authorization: Bearer <jeton>`. Jeton vide : désactivé."""

    def __init__(self, app: Callable[[Scope, Receive, Send], Awaitable[None]], token: str) -> None:
        self.app = app
        self.token = token.encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.token:
            await self.app(scope, receive, send)
            return
        header = dict(scope["headers"]).get(b"authorization", b"")
        scheme, _, given = header.partition(b" ")
        if scheme.lower() == b"bearer" and hmac.compare_digest(given.strip(), self.token):
            await self.app(scope, receive, send)
            return
        body = b'{"error":"jeton manquant ou invalide"}'
        await send({"type": "http.response.start", "status": 401, "headers": [
            (b"content-type", b"application/json"), (b"www-authenticate", b"Bearer"),
            (b"content-length", str(len(body)).encode())]})  # fmt: skip
        await send({"type": "http.response.body", "body": body})


def http_app(server: MCPServer, settings: Settings) -> Any:
    """Application ASGI (streamable HTTP, chemin /mcp) protégée par jeton si MCP_TOKEN est défini."""
    hosts = [h.strip() for h in settings.mcp_allowed_hosts.split(",") if h.strip()]
    security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=hosts,
        allowed_origins=[],
    )
    app = server.streamable_http_app(transport_security=security, host=settings.mcp_host)
    return BearerTokenMiddleware(app, settings.mcp_token.get_secret_value())


def main(argv: list[str] | None = None) -> int:
    settings = get_settings()
    configure_logging(settings.secret_values())
    parser = argparse.ArgumentParser(prog="python -m app.mcp_server")
    parser.add_argument("--transport", choices=["stdio", "http"], default="stdio")
    parser.add_argument("--host", default=settings.mcp_host)
    parser.add_argument("--port", type=int, default=settings.mcp_port)
    args = parser.parse_args(argv)
    server = build_server(HttpReadApi(settings.mcp_api_url))
    if args.transport == "stdio":
        server.run("stdio")
        return 0
    import uvicorn

    settings = settings.model_copy(update={"mcp_host": args.host})
    if not settings.mcp_token.get_secret_value():
        logger.warning("MCP sans jeton : accès limité au réseau Tailscale (MCP_TOKEN vide).")
    uvicorn.run(http_app(server, settings), host=args.host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
