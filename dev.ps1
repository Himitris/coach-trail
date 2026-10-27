# Lance Coach Trail en local (sans Docker) : API sur :8000, interface sur :5173.
$root = $PSScriptRoot
$env:DATABASE_PATH = "$root\data\coach.db"
$env:BACKUP_DIR = "$root\data\backup"
$env:GARMIN_TOKEN_DIR = "$root\data\garmin_tokens"
$env:STRAVA_TOKEN_DIR = "$root\data\strava_tokens"
# Optionnel : décommente et renseigne pour le repli Intervals.icu
# $env:INTERVALS_ATHLETE_ID = "i12345"
# $env:INTERVALS_API_KEY = "..."

$api = Start-Process -PassThru -NoNewWindow -WorkingDirectory "$root\backend" `
  -FilePath "$root\backend\.venv\Scripts\python.exe" `
  -ArgumentList "-m","uvicorn","app.main:app_factory","--factory","--port","8000"
try {
  Set-Location "$root\frontend"
  npm run dev
} finally {
  Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
}
