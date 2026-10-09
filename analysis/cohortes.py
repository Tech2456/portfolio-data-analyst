"""Analyse de cohortes : quelle part des clients activés un mois donné
paie encore 1, 2, … 12 mois plus tard ?

C'est la vue qui explique le taux de réabonnement global : elle montre
*quand* les clients partent et *quels canaux* amènent des clients fidèles.
"""

from __future__ import annotations

import pandas as pd


def retention_matrix(sales: pd.DataFrame, payments: pd.DataFrame,
                     max_age: int = 12, by: str | None = None) -> pd.DataFrame:
    """Matrice de rétention (en %) : lignes = cohortes, colonnes = âge en mois.

    `by` permet d'ajouter une dimension (ex. ``"channel_code"``) devant la cohorte.
    Les cellules non encore observables (trop récentes) restent vides (NaN).
    """
    activated = sales.dropna(subset=["activation_date"]).copy()
    activated["cohort"] = pd.to_datetime(activated["activation_date"]).dt.to_period("M")

    paid = payments.merge(activated[["sale_id", "cohort"] + ([by] if by else [])], on="sale_id")
    paid["age"] = (pd.to_datetime(paid["period_month"]).dt.to_period("M") - paid["cohort"]).apply(
        lambda offset: offset.n)
    paid = paid[paid["age"].between(0, max_age)]

    keys = ([by] if by else []) + ["cohort"]
    cohort_size = activated.groupby(keys).size()
    still_paying = paid.groupby(keys + ["age"]).size().unstack("age")
    matrix = still_paying.div(cohort_size, axis=0) * 100

    last_period = pd.to_datetime(payments["period_month"]).max().to_period("M")
    cohorts = matrix.index.get_level_values("cohort")
    for age in matrix.columns:
        not_observable = (last_period - cohorts).map(lambda offset: offset.n) < age
        matrix.loc[not_observable, age] = float("nan")
    return matrix.round(1)


def retention_by_channel(sales: pd.DataFrame, payments: pd.DataFrame,
                         ages: tuple[int, ...] = (1, 3, 6, 12)) -> pd.DataFrame:
    """Rétention moyenne pondérée par canal à quelques âges clés."""
    matrix = retention_matrix(sales, payments, max_age=max(ages), by="channel_code")
    activated = sales.dropna(subset=["activation_date"]).copy()
    activated["cohort"] = pd.to_datetime(activated["activation_date"]).dt.to_period("M")
    sizes = activated.groupby(["channel_code", "cohort"]).size()

    rows = {}
    for channel, block in matrix.groupby(level="channel_code"):
        weights = sizes.loc[block.index]
        rows[channel] = {
            f"M{age}": round(float((block[age] * weights).sum() / weights[block[age].notna()].sum()), 1)
            for age in ages
        }
    return pd.DataFrame.from_dict(rows, orient="index")
