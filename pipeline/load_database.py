"""Crée le schéma `fibrenet_bi` puis charge les CSV de data/raw/.

Usage : python -m pipeline.load_database
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from pipeline.db import connect, run_script

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"

# Ordre imposé par les clés étrangères.
LOAD_ORDER = ["zones", "channels", "offers", "agents", "sales", "payments", "leads", "targets"]
BATCH_SIZE = 5_000


def load_table(conn, table: str) -> int:
    df = pd.read_csv(RAW / f"{table}.csv")
    df = df.astype(object).where(df.notna(), None)
    columns = ", ".join(df.columns)
    placeholders = ", ".join(["%s"] * len(df.columns))
    sql = f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"
    rows = [tuple(r) for r in df.itertuples(index=False, name=None)]
    with conn.cursor() as cur:
        for start in range(0, len(rows), BATCH_SIZE):
            cur.executemany(sql, rows[start:start + BATCH_SIZE])
    conn.commit()
    return len(rows)


def main() -> None:
    if not (RAW / "sales.csv").exists():
        raise SystemExit("Données absentes : lancez d'abord `python data/generate_dataset.py`.")
    with connect(database=None) as conn:
        run_script(conn, ROOT / "sql" / "00_schema.sql")
    with connect() as conn:
        for table in LOAD_ORDER:
            print(f"{table:<10} {load_table(conn, table):>8,} lignes chargées".replace(",", " "))


if __name__ == "__main__":
    main()
