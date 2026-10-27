from fastapi import APIRouter, Request

from app.backup import BackupService, BackupStatus

router = APIRouter(prefix="/backup")


@router.get("/status", response_model=BackupStatus)
def backup_status(request: Request) -> BackupStatus:
    """Dernier résultat connu : lecture du fichier d'état, aucune sauvegarde lancée."""
    service: BackupService = request.app.state.backup
    return service.status()
