-- ============================================================================
-- 002_enrichment_fields — columnas para datos de enriquecimiento externo
-- (Apollo, Hunter, manual). Todas nullable.
-- ============================================================================

ALTER TABLE companies
  ADD COLUMN industry         VARCHAR(100) NULL        AFTER description,
  ADD COLUMN employees_size   VARCHAR(20)  NULL        COMMENT 'bucket: 1-10, 11-50, 51-200, 201-500, 500+' AFTER industry,
  ADD COLUMN employees_exact  INT UNSIGNED NULL        AFTER employees_size,
  ADD COLUMN founded_year     SMALLINT UNSIGNED NULL   AFTER employees_exact,
  ADD COLUMN enriched_at      DATETIME     NULL        AFTER status,
  ADD COLUMN enrichment_source VARCHAR(50) NULL        COMMENT 'apollo / hunter / manual' AFTER enriched_at,
  ADD KEY idx_companies_industry (industry),
  ADD KEY idx_companies_enriched_at (enriched_at);
