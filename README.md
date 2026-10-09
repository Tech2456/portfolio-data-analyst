# Pilotage commercial par la donnée : étude de cas FibreNet Faso

**Portfolio en ligne :** https://tech2456.github.io/portfolio-data-analyst/

Étude de cas complète d'analyse commerciale pour un fournisseur d'accès Internet fibre **fictif** à Ouagadougou :
12 quartiers, 5 canaux de vente, 30 agents terrain, 21 mois d'activité. Les données sont simulées. Trois anomalies y
sont cachées volontairement, et la chaîne d'analyse doit les retrouver sans fausse alerte.

| Anomalie cachée | Méthode qui la retrouve |
|---|---|
| Le canal Distributeurs décroche à Tampouy et Tanghin (août 2026) | SQL (écart > 2σ vs moyenne 3 mois) + Python CUSUM |
| L'agent AG-017 gonfle ses ventes (jamais activées, clients recyclés, fin de mois) | SQL : score de risque multi-signaux (z-scores) |
| Les clients du Digital se réabonnent beaucoup moins | Python : matrice de cohortes |

## Architecture

```
data/generate_dataset.py      simulation réaliste (saisonnalité, croissance, churn par canal)
        │
sql/00_schema.sql             modèle MariaDB : 8 tables, clés étrangères, index
pipeline/load_database.py     chargement par lots
        │
sql/01 … 06                   KPIs, parc & réabonnement, alertes, entonnoir, ventes suspectes, potentiel par zone
pipeline/export_kpis.py       exécution des requêtes → JSON
        │
analysis/cohortes.py          rétention par cohorte d'activation et par canal
analysis/ruptures.py          détection de dérives (CUSUM sur résidus binomiaux)
        │
reporting/rapport_mensuel.py  classeur Excel du comité (5 onglets, mise en forme conditionnelle, graphique)
site/                         tableau de bord web (Chart.js), publié sur GitHub Pages
```

## Lancer le projet

Prérequis : Python 3.11+, MariaDB 10.4+ ou MySQL 8+ (par exemple via XAMPP).

```bash
pip install -r requirements.txt
python run_all.py          # simulation → base → SQL → analyses → Excel (moins de 20 s)
python -m pytest           # 19 tests
python -m http.server -d site 8000
```

Connexion à la base par variables d'environnement : `FIBRENET_DB_HOST`, `FIBRENET_DB_PORT`, `FIBRENET_DB_USER`,
`FIBRENET_DB_PASSWORD`. Par défaut : `root` sans mot de passe sur `127.0.0.1:3306`.

## Choix techniques

- **SQL d'abord.** Les KPIs sont calculés en base avec des CTE et des fonctions de fenêtrage (`LAG`, moyennes mobiles,
  parts du total, z-scores, normalisation min-max), comme dans un vrai environnement BI.
- **Alertes avec seuil statistique.** Un écart n'est signalé que s'il dépasse 2σ (approximation de Poisson). On ne
  réagit pas au bruit des petits volumes.
- **Deux méthodes complémentaires.** La moyenne mobile détecte les chutes brutales. Le CUSUM détecte les dérives qui
  s'installent, que la moyenne mobile finit par absorber.
- **Pseudonymisation.** Aucune donnée personnelle : les clients sont identifiés par un hachage.
- **Reproductible et testé.** Une graine fixe, une commande pour tout reconstruire, et 19 tests automatisés (`python -m pytest`).

---

Aboubacar Bassinga · bassingaaboubacar3@gmail.com · Ouagadougou
