-- ============================================================================
-- 003_competitor_sources — extender `sources` para alojar las 65 ticketeras
-- competencia importadas desde el Excel + admin panel (`/admin/scrapers`).
--
-- Las 5 fuentes seed existentes (taquilla, ticketmaster, eventbrite, fever,
-- elcorteingles) quedan con is_competitor=FALSE. Las nuevas se insertan con
-- is_competitor=TRUE y active=FALSE hasta tener config_json poblado.
-- ============================================================================

ALTER TABLE sources
  ADD COLUMN difficulty     TINYINT UNSIGNED NULL
    COMMENT 'Dificultad obtener cliente (1-5, del Excel)' AFTER active,
  ADD COLUMN is_competitor  BOOLEAN          NOT NULL DEFAULT FALSE AFTER difficulty,
  ADD COLUMN description    TEXT             NULL AFTER is_competitor,
  ADD COLUMN notes          TEXT             NULL AFTER description,
  ADD COLUMN white_label_of VARCHAR(255)     NULL
    COMMENT 'Si es marca blanca, plataforma origen' AFTER notes,
  ADD COLUMN cashless        ENUM('yes','no','unknown') NOT NULL DEFAULT 'unknown' AFTER white_label_of,
  ADD COLUMN instagram_url   VARCHAR(500)    NULL AFTER cashless,
  ADD COLUMN updated_at      TIMESTAMP       NOT NULL
    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

CREATE INDEX idx_sources_competitor ON sources(is_competitor);
CREATE INDEX idx_sources_active     ON sources(active);
