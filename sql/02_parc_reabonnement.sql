-- ---------------------------------------------------------------------
-- KPI 2 — Parc actif, réabonnement et revenu mensuel.
-- Parc actif du mois M     = abonnements ayant payé le mois M.
-- Taux de réabonnement M   = part des payeurs de M-1 qui ont repayé en M.
-- ---------------------------------------------------------------------
WITH paid AS (
    SELECT
        p.sale_id,
        p.period_month,
        p.amount,
        LAG(p.period_month) OVER (PARTITION BY p.sale_id ORDER BY p.period_month) AS previous_period
    FROM payments p
),
per_month AS (
    SELECT
        period_month                                                    AS month,
        COUNT(*)                                                        AS active_park,
        SUM(previous_period IS NULL)                                    AS new_activations,
        SUM(previous_period = period_month - INTERVAL 1 MONTH)          AS renewed,
        SUM(amount)                                                     AS revenue_fcfa
    FROM paid
    GROUP BY period_month
)
SELECT
    month,
    active_park,
    new_activations,
    renewed,
    LAG(active_park) OVER (ORDER BY month)                              AS eligible_to_renew,
    ROUND(100 * renewed / LAG(active_park) OVER (ORDER BY month), 1)    AS renewal_rate_pct,
    revenue_fcfa,
    ROUND(revenue_fcfa / active_park)                                   AS arpu_fcfa
FROM per_month
ORDER BY month;
