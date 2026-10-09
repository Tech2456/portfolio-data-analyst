-- ---------------------------------------------------------------------
-- Alertes du dernier mois clos : chaque couple canal × zone est comparé
-- à sa propre référence (moyenne des 3 mois précédents), pour détecter
-- les ruptures de tendance que l'agrégat national masque.
--
-- Un écart n'est retenu que s'il dépasse le bruit statistique attendu :
-- des ventes mensuelles se comportent à peu près comme une loi de
-- Poisson (écart-type ≈ √moyenne). Alerte au-delà de 2σ, critique à 3σ.
-- ---------------------------------------------------------------------
WITH bounds AS (
    SELECT DATE_FORMAT(MAX(sale_date), '%Y-%m-01') AS report_month FROM sales
),
monthly AS (
    SELECT
        DATE_FORMAT(s.sale_date, '%Y-%m-01') AS month,
        s.channel_code,
        s.zone_id,
        COUNT(*)                             AS sales
    FROM sales s
    GROUP BY 1, 2, 3
),
scored AS (
    SELECT
        m.*,
        AVG(m.sales) OVER (PARTITION BY m.channel_code, m.zone_id ORDER BY m.month
                           ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING) AS baseline_3m
    FROM monthly m
),
flagged AS (
    SELECT
        s.*,
        (s.sales - s.baseline_3m) / SQRT(s.baseline_3m) AS sigma
    FROM scored s
    JOIN bounds b ON s.month = b.report_month
    WHERE s.baseline_3m >= 8                  -- volumes trop faibles = bruit
)
SELECT
    c.label                                   AS channel,
    z.zone,
    f.sales                                   AS sales_last_month,
    ROUND(f.baseline_3m, 1)                   AS baseline_3m,
    ROUND(100 * (f.sales / f.baseline_3m - 1), 1) AS deviation_pct,
    ROUND(f.sigma, 1)                         AS sigma,
    CASE WHEN f.sigma <= -3 THEN 'CRITIQUE' ELSE 'ALERTE' END AS severity
FROM flagged f
JOIN channels c ON c.channel_code = f.channel_code
JOIN zones    z ON z.zone_id = f.zone_id
WHERE f.sigma <= -2
ORDER BY f.sigma;
