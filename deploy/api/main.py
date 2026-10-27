from fastapi import FastAPI

app = FastAPI(title="Coach Trail (placeholder)")


@app.get("/api/ping")
def ping() -> dict[str, bool]:
    return {"ok": True}
