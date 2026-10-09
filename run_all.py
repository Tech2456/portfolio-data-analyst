"""Reconstruit tout le projet de bout en bout :

données simulées -> MariaDB -> requêtes SQL -> analyses Python
-> rapport Excel -> fichiers publiés par le site.

Usage : python run_all.py
"""

from __future__ import annotations

import shutil
import time
from pathlib import Path

from analysis import build_insights
from data import generate_dataset
from pipeline import export_kpis, load_database
from reporting import rapport_mensuel

ROOT = Path(__file__).resolve().parent
SITE_ASSETS = ROOT / "site" / "assets"


def publish_sources(report: Path) -> None:
    """Copie les requêtes SQL et le rapport Excel dans le site (affichage + téléchargement)."""
    sql_out = SITE_ASSETS / "sql"
    sql_out.mkdir(parents=True, exist_ok=True)
    for path in (ROOT / "sql").glob("*.sql"):
        shutil.copy2(path, sql_out / path.name)
    shutil.copy2(report, SITE_ASSETS / "rapport_mensuel.xlsx")


def main() -> None:
    steps = [
        ("Génération des données", generate_dataset.main),
        ("Chargement MariaDB", load_database.main),
        ("Requêtes SQL", lambda: print(export_kpis.export_all())),
        ("Analyses Python", build_insights.main),
    ]
    for label, step in steps:
        started = time.perf_counter()
        print(f"\n▶ {label}")
        step()
        print(f"  ✓ {time.perf_counter() - started:.1f} s")

    print("\n▶ Rapport Excel")
    publish_sources(rapport_mensuel.build())
    print("  ✓ site/assets à jour")


if __name__ == "__main__":
    main()
