-- ---------------------------------------------------------------------
-- KPI 1 — Ventes mensuelles par canal : réalisé vs objectif,
-- contribution au total, évolution M-1 et moyenne mobile 3 mois.
-- ---------------------------------------------------------------------
WITH monthly AS (
    SELECT
        DATE_FORMAT(s.sale_date, '%Y-%m-01') AS month,
        s.channel_code,
        COUNT(*)                             AS sales
    FROM sales s
    GROUP BY 1, 2
)
SELECT
    m.month,
    m.channel_code,
    c.label                                                        AS channel,
    m.sales,
    t.target_sales,
    ROUND(100 * m.sales / t.target_sales, 1)                       AS attainment_pct,
    ROUND(100 * m.sales / SUM(m.sales) OVER (PARTITION BY m.month), 1) AS contribution_pct,
    ROUND(100 * (m.sales / LAG(m.sales) OVER w - 1), 1)            AS mom_pct,
    ROUND(AVG(m.sales) OVER (w ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 0) AS sales_3m_avg
FROM monthly m
JOIN channels c ON c.channel_code = m.channel_code
JOIN targets  t ON t.channel_code = m.channel_code AND t.month = m.month
WINDOW w AS (PARTITION BY m.channel_code ORDER BY m.month)
ORDER BY m.month, m.channel_code;
