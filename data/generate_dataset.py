"""Génère le jeu de données simulé de FibreNet Faso (FAI fibre fictif, Ouagadougou).

Les données sont synthétiques mais calibrées pour ressembler à une activité
commerciale réelle : saisonnalité, croissance, churn dépendant du canal et de
l'offre. Trois « histoires » y sont volontairement cachées pour être retrouvées
par l'analyse, comme dans la vraie vie :

1. le canal Distributeurs décroche à partir d'août 2026 sur Tampouy et Tanghin ;
2. un agent terrain (AG-017) gonfle ses ventes à partir de mars 2026
   (ventes jamais activées, numéros réutilisés, pic de fin de mois) ;
3. les clients acquis par le canal Digital se réabonnent nettement moins.

Aucune donnée personnelle : les clients sont identifiés par un hachage.

Usage : python data/generate_dataset.py  (écrit les CSV dans data/raw/)
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 2026
START = pd.Timestamp("2025-01-01")
END = pd.Timestamp("2026-09-30")
OUT_DIR = Path(__file__).resolve().parent / "raw"

SUSPICIOUS_AGENT = "AG-017"
SUSPICIOUS_FROM = pd.Timestamp("2026-03-01")
DISTRIB_DROP_FROM = pd.Timestamp("2026-08-01")
DISTRIB_DROP_ZONES = {"Tampouy", "Tanghin"}


@dataclass(frozen=True)
class Channel:
    code: str
    label: str
    base_sales: int        # ventes mensuelles de départ
    growth: float          # croissance mensuelle
    conversion: float      # prospects -> ventes
    renewal: float         # probabilité mensuelle de réabonnement


CHANNELS = [
    Channel("TER", "Force de vente terrain", 360, 0.012, 0.21, 0.935),
    Channel("BOU", "Boutiques", 210, 0.008, 0.44, 0.945),
    Channel("DIS", "Distributeurs", 165, 0.010, 0.34, 0.915),
    Channel("DIG", "Digital (web & WhatsApp)", 85, 0.040, 0.075, 0.872),
    Channel("TEL", "Télévente", 60, 0.006, 0.12, 0.900),
]

# zone, ménages, foyers raccordables (fibre), indice de revenu (1 = moyen)
ZONES = [
    ("Ouaga 2000", 14_000, 11_500, 1.9),
    ("Karpala", 21_000, 9_800, 1.0),
    ("Tampouy", 38_000, 14_200, 0.8),
    ("Pissy", 41_000, 15_600, 0.8),
    ("Dassasgho", 26_000, 12_900, 1.1),
    ("Patte d'Oie", 19_000, 11_200, 1.3),
    ("Gounghin", 23_000, 10_400, 1.0),
    ("Wemtenga", 22_000, 9_100, 1.0),
    ("Somgandé", 18_000, 6_300, 0.9),
    ("Tanghin", 30_000, 10_800, 0.8),
    ("Zogona", 12_000, 8_700, 1.4),
    ("Cissin", 33_000, 7_400, 0.8),
]

OFFERS = [  # code, libellé, débit Mb/s, prix mensuel FCFA
    ("F20", "Fibre Essentiel 20 Mb/s", 20, 15_000),
    ("F50", "Fibre Confort 50 Mb/s", 50, 25_000),
    ("F100", "Fibre Premium 100 Mb/s", 100, 40_000),
]

SEASONALITY = {1: 0.92, 2: 0.95, 3: 1.0, 4: 1.0, 5: 1.02, 6: 0.98,
               7: 0.94, 8: 0.90, 9: 1.04, 10: 1.06, 11: 1.05, 12: 1.12}


def month_starts() -> list[pd.Timestamp]:
    return list(pd.date_range(START, END, freq="MS"))


def client_hash(n: int) -> str:
    return hashlib.sha256(f"fibrenet-client-{n}".encode()).hexdigest()[:16]


def build_reference_tables() -> dict[str, pd.DataFrame]:
    zones = pd.DataFrame(ZONES, columns=["zone", "households", "homes_passed", "income_index"])
    zones.insert(0, "zone_id", range(1, len(zones) + 1))

    channels = pd.DataFrame([(c.code, c.label) for c in CHANNELS], columns=["channel_code", "label"])
    offers = pd.DataFrame(OFFERS, columns=["offer_code", "label", "speed_mbps", "monthly_price"])

    rng = np.random.default_rng(SEED)
    agents = []
    for i in range(1, 31):
        zone_id = (i - 1) % len(ZONES) + 1
        agents.append((f"AG-{i:03d}", zone_id, START - pd.Timedelta(days=int(rng.integers(30, 400)))))
    agents_df = pd.DataFrame(agents, columns=["agent_id", "zone_id", "hired_on"])
    return {"zones": zones, "channels": channels, "offers": offers, "agents": agents_df}


def offer_probabilities(income_index: float) -> np.ndarray:
    premium = min(0.08 + 0.12 * (income_index - 0.8), 0.32)
    confort = 0.30 + 0.05 * (income_index - 1)
    return np.array([1 - premium - confort, confort, premium])


def generate(seed: int = SEED) -> dict[str, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    ref = build_reference_tables()
    zones, agents = ref["zones"], ref["agents"]

    zone_weight = (zones["homes_passed"] * zones["income_index"] ** 0.5).to_numpy(float)
    zone_weight /= zone_weight.sum()
    agents_by_zone = agents.groupby("zone_id")["agent_id"].apply(list).to_dict()

    sales, leads, targets = [], [], []
    sale_id, client_seq = 0, 0
    recycled_clients: list[str] = []

    for m_idx, month in enumerate(month_starts()):
        days_in_month = month.days_in_month
        season = SEASONALITY[month.month]
        for ch in CHANNELS:
            expected = ch.base_sales * (1 + ch.growth) ** m_idx * season
            targets.append((month.date(), ch.code, int(round(ch.base_sales * (1 + ch.growth) ** m_idx
                                                             * SEASONALITY[month.month] * 1.05, -1))))
            per_zone = rng.multinomial(rng.poisson(expected), zone_weight)

            for z_idx, n_sales in enumerate(per_zone):
                zone = zones.iloc[z_idx]
                if ch.code == "DIS" and month >= DISTRIB_DROP_FROM and zone["zone"] in DISTRIB_DROP_ZONES:
                    n_sales = rng.binomial(n_sales, 0.25)

                n_leads = int(n_sales / ch.conversion * rng.normal(1, 0.06))
                leads.append((month.date(), ch.code, int(zone["zone_id"]), max(n_leads, n_sales)))

                probs = offer_probabilities(zone["income_index"])
                for _ in range(n_sales):
                    sale_id += 1
                    agent = None
                    if ch.code == "TER":
                        agent = rng.choice(agents_by_zone[int(zone["zone_id"])])
                    day = int(rng.integers(1, days_in_month + 1))
                    client_seq += 1
                    sales.append(_make_sale(rng, sale_id, client_hash(client_seq), month, day, ch,
                                            int(zone["zone_id"]), agent, probs, suspicious=False))
                    if agent and len(recycled_clients) < 400:
                        recycled_clients.append(sales[-1]["client_hash"])

            # Agent AG-017 : ventes fictives ajoutées en fin de mois.
            if ch.code == "TER" and month >= SUSPICIOUS_FROM:
                agent_zone = int(agents.loc[agents.agent_id == SUSPICIOUS_AGENT, "zone_id"].iloc[0])
                probs = offer_probabilities(zones.loc[zones.zone_id == agent_zone, "income_index"].iloc[0])
                for _ in range(int(rng.integers(16, 24))):
                    sale_id += 1
                    day = int(rng.integers(max(1, days_in_month - 4), days_in_month + 1))
                    client = (rng.choice(recycled_clients) if rng.random() < 0.35
                              else client_hash(client_seq := client_seq + 1))
                    sales.append(_make_sale(rng, sale_id, client, month, day, ch, agent_zone,
                                            SUSPICIOUS_AGENT, probs, suspicious=True))

    sales_df = pd.DataFrame(sales)
    payments_df = _simulate_payments(rng, sales_df)
    sales_df = sales_df.drop(columns=["sim_renewal", "sim_suspicious"])

    return {
        **ref,
        "sales": sales_df,
        "payments": payments_df,
        "leads": pd.DataFrame(leads, columns=["month", "channel_code", "zone_id", "leads"]),
        "targets": pd.DataFrame(targets, columns=["month", "channel_code", "target_sales"]),
    }


def _make_sale(rng, sale_id, client, month, day, ch: Channel, zone_id, agent, probs, suspicious):
    offer_idx = int(rng.choice(3, p=probs))
    sale_date = month + pd.Timedelta(days=day - 1)
    if suspicious:
        activated = rng.random() > 0.55
    else:
        activated = rng.random() > 0.035
    activation_date = (sale_date + pd.Timedelta(days=int(rng.integers(0, 6)))) if activated else None
    if activation_date is not None and activation_date > END:
        activation_date = None

    renewal = ch.renewal + (offer_idx * 0.008) + rng.normal(0, 0.01)
    if suspicious:
        renewal -= 0.25
    return {
        "sale_id": sale_id,
        "sale_date": sale_date.date(),
        "activation_date": activation_date.date() if activation_date is not None else None,
        "channel_code": ch.code,
        "zone_id": zone_id,
        "agent_id": agent,
        "offer_code": OFFERS[offer_idx][0],
        "client_hash": client,
        "sim_renewal": float(np.clip(renewal, 0.5, 0.985)),
        "sim_suspicious": suspicious,
    }


def _simulate_payments(rng, sales: pd.DataFrame) -> pd.DataFrame:
    """Un paiement par mois de service tant que le client se réabonne."""
    prices = {o[0]: o[3] for o in OFFERS}
    last_month = END.to_period("M")
    rows = []
    for sale in sales.itertuples(index=False):
        if pd.isna(sale.activation_date):
            continue
        period = pd.Timestamp(sale.activation_date).to_period("M")
        renewal = sale.sim_renewal
        first = True
        while period <= last_month:
            rows.append((sale.sale_id, period.to_timestamp().date(), prices[sale.offer_code]))
            # Le premier renouvellement est le plus fragile.
            p = renewal - (0.06 if first else 0.0)
            if rng.random() > p:
                break
            first = False
            period += 1
    return pd.DataFrame(rows, columns=["sale_id", "period_month", "amount"])


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tables = generate()
    for name, df in tables.items():
        df.to_csv(OUT_DIR / f"{name}.csv", index=False)
        print(f"{name:<10} {len(df):>8,} lignes".replace(",", " "))


if __name__ == "__main__":
    main()
