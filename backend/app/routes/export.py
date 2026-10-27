"""Export « Copier pour Claude » : lecture seule de la base locale, uniquement à la demande."""

from datetime import date, timedelta
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy.orm import Session

from app import activities as activities_api
from app.export import builder, details, markdown, streams
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
    format: Literal["md", "json"] = "md",  # noqa: A002
) -> Response:
    priority, tz, today = _ctx(request)
    start, end = _period(request, from_, to)
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
    if format == "json":
        return JSONResponse(data.model_dump(mode="json"))
    name = _streams_name(start, end)
    ref = f"GET /api/export/streams?from={start.isoformat()}&to={end.isoformat()} ({name})"
    return Response(markdown.render_markdown(data, ref), media_type=MD_TYPE)


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
    widget_id: str, request: Request, db: Annotated[Session, Depends(get_db)]
) -> Response:
    """Markdown d'un widget de la disposition, d'après son type et ses réglages."""
    found = details.find_widget(db, widget_id)
    if found is None:
        raise HTTPException(404, "Widget introuvable.")
    priority, tz, today = _ctx(request)
    text = details.widget_markdown(db, *found, priority=priority, tz=tz, today=today)
    if text is None:
        return PlainTextResponse("", status_code=204)
    return Response(text, media_type=MD_TYPE)
