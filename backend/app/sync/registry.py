from collections.abc import Mapping

from app.config import Settings
from app.sync.types import SourceConnector, SourceNormalizer


def build_sources(
    settings: Settings,
) -> tuple[Mapping[str, SourceConnector], Mapping[str, SourceNormalizer]]:
    """Connecteurs et normaliseurs actifs. Aucun pour l'instant (prompts 04 et 11)."""
    return {}, {}
