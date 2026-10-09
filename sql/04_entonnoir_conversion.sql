-- ---------------------------------------------------------------------
-- Entonnoir de conversion par canal (cohortes de ventes d'avril à
-- juin 2026, pour laisser 3 mois de recul sur la fidélisation) :
-- prospects -> ventes -> activations -> clients encore actifs à M+3.
-- ---------------------------------------------------------------------
WITH window_sales AS (
    SELECT s.*
    FROM sales s
    WHERE s.sale_date >= '2026-04-01' AND s.sale_date < '2026-07-01'
),
retained AS (
    SELECT ws.sale_id
    FROM window_sales ws
    JOIN payments p
      ON p.sale_id = ws.sale_id
     AND p.period_month = DATE_FORMAT(ws.sale_date, '%Y-%m-01') + INTERVAL 3 MONTH
),
funnel AS (
    SELECT
        ws.channel_code,
        COUNT(*)                         AS sales,
        COUNT(ws.activation_date)        AS activated,
        COUNT(r.sale_id)                 AS active_m3
    FROM window_sales ws
    LEFT JOIN retained r ON r.sale_id = ws.sale_id
    GROUP BY ws.channel_code
),
prospects AS (
    SELECT channel_code, SUM(leads) AS leads
    FROM leads
    WHERE month >= '2026-04-01' AND month < '2026-07-01'
    GROUP BY channel_code
)
SELECT
    c.label                                         AS channel,
    p.leads,
    f.sales,
    f.activated,
    f.active_m3,
    ROUND(100 * f.sales / p.leads, 1)               AS conversion_pct,
    ROUND(100 * f.activated / f.sales, 1)           AS activation_pct,
    ROUND(100 * f.active_m3 / f.activated, 1)       AS retention_m3_pct,
    ROUND(100 * f.active_m3 / p.leads, 1)           AS end_to_end_pct
FROM funnel f
JOIN prospects p ON p.channel_code = f.channel_code
JOIN channels  c ON c.channel_code = f.channel_code
ORDER BY end_to_end_pct DESC;
