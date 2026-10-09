"""Exécute les requêtes d'analyse (sql/01 à 06) et exporte leurs résultats
en JSON pour le tableau de bord du portfolio.

Usage : python -m pipeline.export_kpis
"""

from __future__ import annotations

import datetime as dt
import decimal
import json
from pathlib import Path

from pipeline.db import connect, run_script

ROOT = Path(__file__).resolve().parents[1]
SQL_DIR = ROOT / "sql"
EXPORT_DIR = ROOT / "site" / "assets" / "data"


def to_json_value(value):
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()[:10]
    return value


def export_all() -> dict[str, int]:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    counts = {}
    with connect() as conn:
        for path in sorted(SQL_DIR.glob("0[1-9]_*.sql")):
            rows = [{k: to_json_value(v) for k, v in row.items()} for row in run_script(conn, path)]
            name = path.stem.split("_", 1)[1]
            (EXPORT_DIR / f"{name}.json").write_text(
                json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            counts[name] = len(rows)
    return counts


if __name__ == "__main__":
    for name, n in export_all().items():
        print(f"{name:<24} {n:>5} lignes")
