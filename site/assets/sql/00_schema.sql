-- =====================================================================
-- FibreNet Faso — modèle de données du pilotage commercial
-- Cible : MariaDB 10.4+ / MySQL 8+ (CTE et fonctions de fenêtrage)
-- =====================================================================

CREATE DATABASE IF NOT EXISTS fibrenet_bi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE fibrenet_bi;

DROP TABLE IF EXISTS payments, sales, leads, targets, agents, offers, channels, zones;

CREATE TABLE zones (
    zone_id        TINYINT UNSIGNED PRIMARY KEY,
    zone           VARCHAR(40)  NOT NULL UNIQUE,
    households     INT UNSIGNED NOT NULL,
    homes_passed   INT UNSIGNED NOT NULL COMMENT 'Foyers raccordables à la fibre',
    income_index   DECIMAL(3,2) NOT NULL COMMENT '1.00 = revenu moyen de la ville'
);

CREATE TABLE channels (
    channel_code   CHAR(3)      PRIMARY KEY,
    label          VARCHAR(40)  NOT NULL
);

CREATE TABLE offers (
    offer_code     VARCHAR(5)   PRIMARY KEY,
    label          VARCHAR(40)  NOT NULL,
    speed_mbps     SMALLINT     NOT NULL,
    monthly_price  INT UNSIGNED NOT NULL COMMENT 'FCFA'
);

CREATE TABLE agents (
    agent_id       CHAR(6)      PRIMARY KEY,
    zone_id        TINYINT UNSIGNED NOT NULL,
    hired_on       DATE         NOT NULL,
    CONSTRAINT fk_agent_zone FOREIGN KEY (zone_id) REFERENCES zones (zone_id)
);

CREATE TABLE sales (
    sale_id         INT UNSIGNED PRIMARY KEY,
    sale_date       DATE         NOT NULL,
    activation_date DATE         NULL COMMENT 'NULL = jamais activée',
    channel_code    CHAR(3)      NOT NULL,
    zone_id         TINYINT UNSIGNED NOT NULL,
    agent_id        CHAR(6)      NULL,
    offer_code      VARCHAR(5)   NOT NULL,
    client_hash     CHAR(16)     NOT NULL COMMENT 'Identifiant client pseudonymisé',
    CONSTRAINT fk_sale_channel FOREIGN KEY (channel_code) REFERENCES channels (channel_code),
    CONSTRAINT fk_sale_zone    FOREIGN KEY (zone_id)      REFERENCES zones (zone_id),
    CONSTRAINT fk_sale_agent   FOREIGN KEY (agent_id)     REFERENCES agents (agent_id),
    CONSTRAINT fk_sale_offer   FOREIGN KEY (offer_code)   REFERENCES offers (offer_code),
    INDEX ix_sales_date (sale_date),
    INDEX ix_sales_channel_zone (channel_code, zone_id),
    INDEX ix_sales_client (client_hash)
);

CREATE TABLE payments (
    sale_id        INT UNSIGNED NOT NULL,
    period_month   DATE         NOT NULL COMMENT 'Premier jour du mois de service payé',
    amount         INT UNSIGNED NOT NULL,
    PRIMARY KEY (sale_id, period_month),
    INDEX ix_payments_period (period_month),
    CONSTRAINT fk_payment_sale FOREIGN KEY (sale_id) REFERENCES sales (sale_id)
);

CREATE TABLE leads (
    month          DATE         NOT NULL,
    channel_code   CHAR(3)      NOT NULL,
    zone_id        TINYINT UNSIGNED NOT NULL,
    leads          INT UNSIGNED NOT NULL,
    PRIMARY KEY (month, channel_code, zone_id)
);

CREATE TABLE targets (
    month          DATE         NOT NULL,
    channel_code   CHAR(3)      NOT NULL,
    target_sales   INT UNSIGNED NOT NULL,
    PRIMARY KEY (month, channel_code)
);
