"""Calcule les analyses Python (cohortes, ruptures) et les exporte en JSON
à côté des résultats SQL, pour le tableau de bord.

Usage : python -m analysis.build_insights
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

import pandas as pd

from analysis.cohortes import retention_by_channel, retention_matrix
from analysis.ruptures import detect_ruptures, zone_shares

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
EXPORT_DIR = ROOT / "site" / "assets" / "data"


def _write(name: str, payload) -> None:
    (EXPORT_DIR / f"{name}.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    sales = pd.read_csv(RAW / "sales.csv")
    payments = pd.read_csv(RAW / "payments.csv")
    zones = pd.read_csv(RAW / "zones.csv").set_index("zone_id")["zone"]
    channels = pd.read_csv(RAW / "channels.csv").set_index("channel_code")["label"]
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    matrix = retention_matrix(sales, payments, max_age=12)
    _write("cohortes", {
        "cohorts": [str(c) for c in matrix.index],
        "ages": [int(a) for a in matrix.columns],
        "values": [[None if pd.isna(v) else float(v) for v in row] for row in matrix.to_numpy()],
    })

    by_channel = retention_by_channel(sales, payments)
    _write("retention_canal", [
        {"channel": channels[code], **row} for code, row in by_channel.to_dict(orient="index").items()
    ])

    detected = detect_ruptures(sales)
    ruptures = [{**asdict(r), "channel": channels[r.channel_code], "zone": zones[r.zone_id]}
                for r in detected]
    _write("ruptures", ruptures)

    shares = zone_shares(sales)
    series_payload = []
    for r in detected:
        series = shares[(shares.channel_code == r.channel_code) & (shares.zone_id == r.zone_id)]
        series = series.sort_values("month")
        series_payload.append({
            "zone": zones[r.zone_id],
            "channel": channels[r.channel_code],
            "reference_pct": r.share_before_pct,
            "months": [str(m) for m in series["month"]],
            "share_pct": [round(100 * v, 1) for v in series["share"]],
        })
    _write("ruptures_series", series_payload)

    print(f"cohortes : {len(matrix)} cohortes · ruptures détectées : {len(ruptures)}")


if __name__ == "__main__":
    main()
