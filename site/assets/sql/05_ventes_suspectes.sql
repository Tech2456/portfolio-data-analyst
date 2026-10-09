-- ---------------------------------------------------------------------
-- Ventes suspectes — profil de risque des agents terrain (6 derniers mois).
-- Quatre signaux, chacun comparé à la population des agents (z-score),
-- puis combinés en un score : un agent n'est signalé que s'il dévie
-- sur plusieurs signaux à la fois, ce qui limite les faux positifs.
-- ---------------------------------------------------------------------
WITH bounds AS (
    SELECT MAX(sale_date) - INTERVAL 6 MONTH AS since,
           MAX(sale_date) - INTERVAL 2 MONTH AS churn_cutoff
    FROM sales
),
first_seen AS (                    -- première vente connue de chaque client
    SELECT client_hash, MIN(sale_id) AS first_sale_id
    FROM sales
    GROUP BY client_hash
),
agent_sales AS (
    SELECT
        s.agent_id,
        s.sale_id,
        s.sale_date,
        s.activation_date,
        (s.sale_id <> fs.first_sale_id)                         AS recycled_client,
        (DAY(LAST_DAY(s.sale_date)) - DAY(s.sale_date) < 5)     AS month_end,
        (s.sale_date < b.churn_cutoff)                          AS churn_observable,
        (SELECT COUNT(*) FROM payments p WHERE p.sale_id = s.sale_id) AS months_paid
    FROM sales s
    JOIN bounds b      ON s.sale_date >= b.since
    JOIN first_seen fs ON fs.client_hash = s.client_hash
    WHERE s.agent_id IS NOT NULL
),
signals AS (
    SELECT
        agent_id,
        COUNT(*)                                                       AS sales,
        100 * AVG(activation_date IS NULL)                             AS never_activated_pct,
        100 * AVG(recycled_client)                                     AS recycled_client_pct,
        100 * AVG(month_end)                                           AS month_end_pct,
        100 * SUM(churn_observable AND activation_date IS NOT NULL AND months_paid <= 1)
            / NULLIF(SUM(churn_observable AND activation_date IS NOT NULL), 0) AS early_churn_pct
    FROM agent_sales
    GROUP BY agent_id
),
zscores AS (
    SELECT
        s.*,
        (never_activated_pct - AVG(never_activated_pct) OVER ()) / STDDEV_POP(never_activated_pct) OVER () AS z_never_activated,
        (recycled_client_pct - AVG(recycled_client_pct) OVER ()) / STDDEV_POP(recycled_client_pct) OVER () AS z_recycled,
        (month_end_pct       - AVG(month_end_pct)       OVER ()) / STDDEV_POP(month_end_pct)       OVER () AS z_month_end,
        (early_churn_pct     - AVG(early_churn_pct)     OVER ()) / STDDEV_POP(early_churn_pct)     OVER () AS z_early_churn
    FROM signals s
)
SELECT
    agent_id,
    z.zone,
    sales,
    ROUND(never_activated_pct, 1)  AS never_activated_pct,
    ROUND(recycled_client_pct, 1)  AS recycled_client_pct,
    ROUND(month_end_pct, 1)        AS month_end_pct,
    ROUND(early_churn_pct, 1)      AS early_churn_pct,
    ROUND(GREATEST(z_never_activated, 0) + GREATEST(z_recycled, 0)
        + GREATEST(z_month_end, 0)       + GREATEST(z_early_churn, 0), 1) AS risk_score,
    (z_never_activated > 2) + (z_recycled > 2) + (z_month_end > 2) + (z_early_churn > 2) AS red_flags
FROM zscores
JOIN agents a USING (agent_id)
JOIN zones  z ON z.zone_id = a.zone_id
ORDER BY risk_score DESC;
