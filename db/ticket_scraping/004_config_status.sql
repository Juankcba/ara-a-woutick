-- ============================================================================
-- 004_config_status — track del avance del maratón de scrapers competencia
--
-- Estados:
--   empty       : config={} (default tras importar del Excel)
--   draft       : config tiene strategy + params, falta validar con test
--   tested      : test_scraper.ts corrió OK pero todavía no en producción
--   production  : active=TRUE y al menos una run real sin errores
--
-- Las 5 sources seed (TM, Taquilla, Fever, ECI, Eventbrite) + apm_musical
-- van a 'production' porque ya tienen scraper dedicado (no usan config_json).
-- ============================================================================

ALTER TABLE sources
  ADD COLUMN config_status ENUM('empty','draft','tested','production')
    NOT NULL DEFAULT 'empty' AFTER cashless;

-- Backfill: las seed con scraper propio ya están en producción
UPDATE sources
   SET config_status = 'production'
 WHERE is_competitor = FALSE;

CREATE INDEX idx_sources_config_status ON sources(config_status);
