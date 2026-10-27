"""Glossaire des métriques et niveaux de preuve (un indicateur n'est pas une vérité)."""

from dataclasses import dataclass


@dataclass(frozen=True)
class GlossaryEntry:
    key: str
    name: str
    evidence: str
    text: str


GLOSSARY: tuple[GlossaryEntry, ...] = (
    GlossaryEntry(
        "volume",
        "Volume (temps, distance, D+)",
        "établi",
        "Mesuré par la montre. Hausse de temps d'une semaine à l'autre : repère de bon sens "
        "d'environ +10 %, jamais un prédicteur de blessure.",
    ),
    GlossaryEntry(
        "intensite",
        "Répartition des intensités",
        "indicatif",
        "Temps par zone de FC (zones 1–2 = « bas d'intensité », cible 75–80 % du temps), "
        "agrégé par semaine. Les courses sont exclues. Aucun jugement à la séance.",
    ),
    GlossaryEntry(
        "ctl",
        "CTL / ATL / TSB",
        "indicatif",
        "Charge d'entraînement estimée depuis la FC (constantes 42 j et 7 j). Courbe de tendance "
        "simplifiée, pas un verdict ni un score de forme.",
    ),
    GlossaryEntry(
        "hrv",
        "HRV nocturne, FC de repos, sommeil",
        "indicatif",
        "Mesures de la montre lues en tendance : moyenne 7 j comparée à la base individuelle "
        "(30–60 j). Une nuit isolée ne dit rien ; pas de feu vert/rouge quotidien.",
    ),
    GlossaryEntry(
        "srpe",
        "Charge perçue (RPE × minutes)",
        "établi",
        "Saisie de l'athlète, en unités arbitraires.",
    ),
    GlossaryEntry(
        "readiness",
        "Training Readiness, Body Battery, plage HRV Garmin",
        "avis de la montre",
        "Indicateurs propriétaires de Garmin, repris tels quels, non validés. À ne pas traiter "
        "comme une mesure.",
    ),
    GlossaryEntry(
        "acwr",
        "ACWR",
        "non validé",
        "Valeur Garmin affichée à titre d'information. Aucune alerte de blessure n'en est tirée.",
    ),
    GlossaryEntry(
        "climbs",
        "Côtes détectées",
        "indicatif",
        "Découpage du profil lissé (dénivelé ≥ 50 m, pente ≥ 3 %) : ordre de grandeur, pas une "
        "mesure.",
    ),
    GlossaryEntry(
        "course",
        "Jour de course",
        "établi",
        "La FC de compétition n'est pas comparée à celle des séances.",
    ),
)
