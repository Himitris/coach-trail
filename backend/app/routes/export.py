"""Export « Copier pour Claude » : lecture seule de la base locale, uniquement à la demande."""

from datetime import date, timedelta
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy.orm import Session

from app import activities as activities_api
from app.export import builder, details, markdown, series, streams
from app.metrics import service
from app.models import Activity
from app.routes.deps import get_db
from app.sync.dedup import primary_activities

router = APIRouter(prefix="/export")

DEFAULT_DAYS = 28
MAX_STREAM_ACTIVITIES = 60
MD_TYPE = "text/markdown; charset=utf-8"


def _ctx(request: Request) -> tuple[list[str], ZoneInfo, date]:
    settings = request.app.state.settings
    today = request.app.state.today()
    return settings.priority_list, ZoneInfo(settings.tz), today


def _period(request: Request, from_: date | None, to: date | None) -> tuple[date, date]:
    today = request.app.state.today()
    end = to or today
    return from_ or end - timedelta(days=DEFAULT_DAYS - 1), end


def _streams_name(start: date, end: date) -> str:
    return f"coach-trail-flux_{start.isoformat()}_{end.isoformat()}.json"


@router.get("")
def export(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    scope: str | None = None,
    format: Literal["md", "json", "csv"] = "md",  # noqa: A002
    series_name: Annotated[str, Query(alias="series")] = "activities",
) -> Response:
    """Export du paquet pour Claude : Markdown, JSON versionné ou une série en CSV."""
    priority, tz, today = _ctx(request)
    start, end = _period(request, from_, to)
    if format == "csv":
        ctx = series.Ctx(db, priority, tz, today, start, end)
        try:
            table = series.build_table(series_name, ctx)
        except series.SeriesError as exc:
            raise HTTPException(422, str(exc)) from exc
        name = f"coach-trail-{table.name}_{start.isoformat()}_{end.isoformat()}.csv"
        return Response(
            series.to_csv(table),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )
    try:
        data = builder.build_export(
            db,
            start=start,
            end=end,
            scope=builder.parse_scope(scope),
            priority=priority,
            tz=tz,
            today=today,
        )
    except builder.ExportError as exc:
        raise HTTPException(422, str(exc)) from exc
    name = _streams_name(start, end)
    streams_url = f"/api/export/streams?from={start.isoformat()}&to={end.isoformat()}"
    if format == "json":
        data.streams_url = streams_url
        return JSONResponse(
            data.model_dump(mode="json"),
            headers={
                "Content-Disposition": f'attachment; filename="coach-trail_{start}_{end}.json"'
            },
        )
    return Response(
        markdown.render_markdown(data, f"GET {streams_url} ({name})"), media_type=MD_TYPE
    )


@router.get("/streams")
def export_streams(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    interval: Annotated[int, Query(ge=streams.MIN_INTERVAL_S, le=streams.MAX_INTERVAL_S)] = (
        streams.DEFAULT_INTERVAL_S
    ),
) -> Response:
    """JSON téléchargeable : flux des séances de la période, un point toutes les `interval` s."""
    priority, tz, _ = _ctx(request)
    start, end = _period(request, from_, to)
    if start > end:
        raise HTTPException(422, "« from » doit précéder « to ».")
    if (end - start).days + 1 > builder.MAX_SPAN_DAYS:
        raise HTTPException(422, f"Période limitée à {builder.MAX_SPAN_DAYS} jours.")
    items: list[dict[str, Any]] = []
    for act in reversed(primary_activities(db, priority)):
        day = service.local_day(act.start_utc, tz)
        if not start <= day <= end:
            continue
        if len(items) >= MAX_STREAM_ACTIVITIES:
            break
        columns = streams.activity_stream(db, act.id, interval)
        if columns is not None:
            items.append(
                {"activity_id": act.id, "date": day.isoformat(), "sport": act.sport, **columns}
            )
    body = {
        "interval_s": interval,
        "from": start.isoformat(),
        "to": end.isoformat(),
        "activities": items,
    }
    return JSONResponse(
        body,
        headers={"Content-Disposition": f'attachment; filename="{_streams_name(start, end)}"'},
    )


@router.get("/activity/{activity_id}")
def export_activity(
    activity_id: int,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    format: Literal["md", "json"] = "md",  # noqa: A002
) -> Response:
    if db.get(Activity, activity_id) is None:
        raise HTTPException(404, "Sortie introuvable.")
    detail = activities_api.activity_detail(activity_id, request, db)
    if format == "md":
        return Response(details.render_activity_detail(detail), media_type=MD_TYPE)
    body = detail.model_dump(mode="json", exclude={"stream"})
    body["stream"] = streams.activity_stream(db, activity_id)
    return JSONResponse(body)


@router.get("/widget/{widget_id}")
def export_widget(
    widget_id: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    format: Literal["md", "json", "csv"] = "md",  # noqa: A002
) -> Response:
    """Export d'un widget de la disposition : Markdown, ou sa série en JSON / CSV."""
    found = details.find_widget(db, widget_id)
    if found is None:
        raise HTTPException(404, "Widget introuvable.")
    priority, tz, today = _ctx(request)
    if format == "md":
        text = details.widget_markdown(db, *found, priority=priority, tz=tz, today=today)
        if text is None:
            return PlainTextResponse("", status_code=204)
        return Response(text, media_type=MD_TYPE)
    table = details.widget_table(db, *found, priority=priority, tz=tz, today=today)
    if table is None:
        raise HTTPException(
            422, f"Ce widget (« {found[0]} ») n'a pas de série à exporter en {format.upper()}."
        )
    name = f"coach-trail-{found[0]}-{table.name}"
    if format == "csv":
        return Response(
            series.to_csv(table),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{name}.csv"'},
        )
    return JSONResponse(
        series.to_json(table, {"widget": found[0], "generated_on": today.isoformat()}),
        headers={"Content-Disposition": f'attachment; filename="{name}.json"'},
    )
