FROM python:3.12-slim AS builder
WORKDIR /build
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir --prefix=/install .

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin coach \
    && mkdir -p /data && chown coach:coach /data
COPY --from=builder /install /usr/local
WORKDIR /srv
COPY --chown=coach:coach app ./app
COPY --chown=coach:coach alembic ./alembic
COPY --chown=coach:coach alembic.ini ./
USER coach
EXPOSE 8000
CMD ["uvicorn", "app.main:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000"]
