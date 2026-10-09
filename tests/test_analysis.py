import numpy as np
import pandas as pd
import pytest

from analysis.cohortes import retention_matrix
from analysis.ruptures import cusum_lower, detect_ruptures
from data.generate_dataset import ZONES, offer_probabilities
from pipeline.db import split_statements


# --- CUSUM -------------------------------------------------------------------

def test_cusum_ignores_noise_around_reference():
    rng = np.random.default_rng(0)
    assert cusum_lower(rng.normal(0, 1, 24)) is None


def test_cusum_detects_sustained_drop_after_a_few_points():
    z = np.array([0.2, -0.3, 0.1, -2.5, -2.5, -2.5, -2.5])
    assert cusum_lower(z) == 5


def test_cusum_does_not_fire_on_single_outlier():
    assert cusum_lower(np.array([0, 0, -4.5, 0, 0, 0])) is None


def _sales_frame(monthly_counts: dict[int, list[int]]) -> pd.DataFrame:
    rows = []
    for zone_id, counts in monthly_counts.items():
        for month_idx, n in enumerate(counts):
            day = pd.Timestamp("2025-01-01") + pd.DateOffset(months=month_idx)
            rows += [{"sale_date": day.date(), "channel_code": "DIS", "zone_id": zone_id}] * n
    return pd.DataFrame(rows)


def test_detect_ruptures_flags_only_the_collapsing_zone():
    stable = [40] * 18
    collapsing = [40] * 14 + [8, 6, 5, 5]
    found = detect_ruptures(_sales_frame({1: stable, 2: stable, 3: collapsing}), calibration_months=12)
    assert [r.zone_id for r in found] == [3]
    assert found[0].share_after_pct < found[0].share_before_pct


# --- Cohortes ----------------------------------------------------------------

def test_retention_matrix_counts_payers_by_age():
    sales = pd.DataFrame({
        "sale_id": [1, 2, 3, 4],
        "activation_date": ["2026-01-05", "2026-01-20", "2026-01-25", None],
    })
    payments = pd.DataFrame({
        "sale_id": [1, 1, 1, 2, 2, 3],
        "period_month": ["2026-01-01", "2026-02-01", "2026-03-01", "2026-01-01", "2026-02-01", "2026-01-01"],
    })
    matrix = retention_matrix(sales, payments, max_age=2)
    assert matrix.loc[pd.Period("2026-01", "M")].tolist() == [100.0, 66.7, 33.3]


def test_retention_matrix_hides_unobservable_ages():
    sales = pd.DataFrame({"sale_id": [1, 2], "activation_date": ["2026-01-10", "2026-03-10"]})
    payments = pd.DataFrame({"sale_id": [1, 1, 1, 2],
                             "period_month": ["2026-01-01", "2026-02-01", "2026-03-01", "2026-03-01"]})
    matrix = retention_matrix(sales, payments, max_age=2)
    assert np.isnan(matrix.loc[pd.Period("2026-03", "M"), 1])


# --- Générateur & utilitaires ------------------------------------------------

@pytest.mark.parametrize("income", [z[3] for z in ZONES])
def test_offer_mix_is_a_probability_distribution(income):
    probs = offer_probabilities(income)
    assert probs.sum() == pytest.approx(1.0)
    assert (probs > 0).all()


def test_split_statements_drops_comments_and_empty_parts():
    sql = "-- titre ; avec point-virgule\nSELECT 1;\n\n-- fin\nSELECT 2;"
    assert split_statements(sql) == ["SELECT 1", "SELECT 2"]
