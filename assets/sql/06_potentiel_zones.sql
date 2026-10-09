-- ---------------------------------------------------------------------
-- Potentiel par zone et priorisation de la prospection.
-- Score = 45 % marge de conquête (foyers raccordables non abonnés)
--       + 25 % pouvoir d'achat + 20 % fidélité + 10 % dynamique récente,
-- chaque composante normalisée min-max entre zones (0 à 1).
-- ---------------------------------------------------------------------
WITH last_month AS (
    SELECT MAX(period_month) AS m FROM payments
),
park AS (
    SELECT s.zone_id,
           SUM(p.period_month = lm.m)                         AS active_subscribers,
           SUM(p.period_month = lm.m - INTERVAL 1 MONTH)      AS active_previous
    FROM payments p
    JOIN sales s USING (sale_id)
    CROSS JOIN last_month lm
    WHERE p.period_month >= lm.m - INTERVAL 1 MONTH
    GROUP BY s.zone_id
),
renewal AS (                       -- payeurs de M-1 toujours là en M
    SELECT s.zone_id, COUNT(*) AS renewed
    FROM payments cur
    JOIN payments prev ON prev.sale_id = cur.sale_id
                      AND prev.period_month = cur.period_month - INTERVAL 1 MONTH
    JOIN sales s ON s.sale_id = cur.sale_id
    CROSS JOIN last_month lm
    WHERE cur.period_month = lm.m
    GROUP BY s.zone_id
),
momentum AS (                      -- ventes des 3 derniers mois vs 3 précédents
    SELECT zone_id,
           SUM(sale_date >= lm.m - INTERVAL 2 MONTH)                       AS sales_recent,
           SUM(sale_date <  lm.m - INTERVAL 2 MONTH)                       AS sales_before
    FROM sales CROSS JOIN last_month lm
    WHERE sale_date >= lm.m - INTERVAL 5 MONTH
    GROUP BY zone_id
),
base AS (
    SELECT
        z.zone,
        z.homes_passed,
        z.income_index,
        p.active_subscribers,
        z.homes_passed - p.active_subscribers                   AS headroom,
        100 * p.active_subscribers / z.homes_passed             AS penetration_pct,
        100 * r.renewed / p.active_previous                     AS renewal_pct,
        100 * (m.sales_recent / m.sales_before - 1)             AS momentum_pct
    FROM zones z
    JOIN park     p ON p.zone_id = z.zone_id
    JOIN renewal  r ON r.zone_id = z.zone_id
    JOIN momentum m ON m.zone_id = z.zone_id
),
normalised AS (
    SELECT b.*,
        (headroom     - MIN(headroom)     OVER ()) / (MAX(headroom)     OVER () - MIN(headroom)     OVER ()) AS n_headroom,
        (income_index - MIN(income_index) OVER ()) / (MAX(income_index) OVER () - MIN(income_index) OVER ()) AS n_income,
        (renewal_pct  - MIN(renewal_pct)  OVER ()) / (MAX(renewal_pct)  OVER () - MIN(renewal_pct)  OVER ()) AS n_renewal,
        (momentum_pct - MIN(momentum_pct) OVER ()) / (MAX(momentum_pct) OVER () - MIN(momentum_pct) OVER ()) AS n_momentum
    FROM base b
)
SELECT
    zone,
    homes_passed,
    active_subscribers,
    headroom,
    ROUND(penetration_pct, 1)                                                AS penetration_pct,
    ROUND(renewal_pct, 1)                                                    AS renewal_pct,
    ROUND(momentum_pct, 1)                                                   AS momentum_pct,
    ROUND(100 * (0.45 * n_headroom + 0.25 * n_income + 0.20 * n_renewal + 0.10 * n_momentum), 0) AS priority_score,
    RANK() OVER (ORDER BY 0.45 * n_headroom + 0.25 * n_income + 0.20 * n_renewal + 0.10 * n_momentum DESC) AS priority_rank
FROM normalised
ORDER BY priority_rank;
