"""Détection de ruptures de tendance par CUSUM.

La comparaison « mois courant vs moyenne des 3 mois précédents » (sql/03)
attrape les chutes brutales, mais rate une dérive qui s'installe : au
bout de deux mois, la référence a déjà intégré la baisse. Le CUSUM
(somme cumulée des écarts) accumule les petits écarts négatifs et
signale le mois où la dérive devient statistiquement anormale.

On travaille sur la *part* d'une zone dans les ventes de son canal : cela
neutralise la saisonnalité et la croissance, communes à toutes les zones.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Rupture:
    channel_code: str
    zone_id: int
    detected_month: str
    share_before_pct: float
    share_after_pct: float


def cusum_lower(z_scores: np.ndarray, k: float = 0.5, h: float = 5.0) -> int | None:
    """CUSUM unilatéral (détection de baisse) sur des écarts standardisés.

    Renvoie l'indice du premier point où la somme cumulée dépasse `h`,
    ou ``None``. `k` est la tolérance absorbée à chaque pas : un écart
    isolé d'un demi écart-type ne déclenche jamais rien.
    """
    statistic = 0.0
    for i, z in enumerate(z_scores):
        statistic = max(0.0, statistic - z - k)
        if statistic > h:
            return i
    return None


def zone_shares(sales: pd.DataFrame) -> pd.DataFrame:
    """Ventes mensuelles par canal × zone, avec le total du canal et la part (0-1)."""
    monthly = (sales.assign(month=pd.to_datetime(sales["sale_date"]).dt.to_period("M"))
               .groupby(["channel_code", "zone_id", "month"]).size().rename("sales").reset_index())
    monthly["channel_total"] = monthly.groupby(["channel_code", "month"])["sales"].transform("sum")
    return monthly.assign(share=monthly["sales"] / monthly["channel_total"])


def detect_ruptures(sales: pd.DataFrame, calibration_months: int = 12) -> list[Rupture]:
    """Calibre la part de chaque zone sur ses premiers mois, puis surveille la suite.

    Chaque mois surveillé, les ventes attendues de la zone suivent une loi
    binomiale (total du canal, part historique) : l'écart observé est
    standardisé par son écart-type théorique avant d'alimenter le CUSUM.
    Les petites zones ne déclenchent donc pas d'alerte sur du simple bruit.
    """
    shares = zone_shares(sales)
    found = []
    for (channel, zone), series in shares.groupby(["channel_code", "zone_id"]):
        series = series.sort_values("month")
        history = series.iloc[:calibration_months]
        watch = series.iloc[calibration_months:]
        ref_share = history["sales"].sum() / history["channel_total"].sum()
        expected = watch["channel_total"] * ref_share
        z = (watch["sales"] - expected) / np.sqrt(expected * (1 - ref_share))
        idx = cusum_lower(z.to_numpy())
        if idx is None:
            continue
        detected = watch.iloc[idx]["month"]
        after = series[series["month"] >= detected]
        found.append(Rupture(
            channel_code=channel,
            zone_id=int(zone),
            detected_month=str(detected),
            share_before_pct=round(100 * float(ref_share), 1),
            share_after_pct=round(100 * float(after["sales"].sum() / after["channel_total"].sum()), 1),
        ))
    return found
