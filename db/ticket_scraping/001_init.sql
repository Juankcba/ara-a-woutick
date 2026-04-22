-- ============================================================================
-- ticket_scraping — schema inicial
-- DB donde vuelcan los scrapers (n8n + workers). Guardamos JSON crudo en
-- raw_events.payload — nunca perdemos info aunque la promoción falle.
-- Un job aparte lee de acá y promueve a ticket_public.
-- ============================================================================

-- Fuentes de scraping (mismo universo que ticket_public.platforms)
CREATE TABLE sources (
  id              SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(50)       NOT NULL,
  name            VARCHAR(100)      NOT NULL,
  kind            ENUM('api','html','hybrid') NOT NULL,
  base_url        VARCHAR(500)      NULL,
  config          JSON              NULL COMMENT 'rate limits, auth, selectors...',
  active          BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sources_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ejecución de un scraper (1 por corrida programada o manual)
CREATE TABLE scraping_runs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id       SMALLINT UNSIGNED NOT NULL,
  triggered_by    ENUM('cron','manual','n8n','retry') NOT NULL DEFAULT 'cron',
  started_at      DATETIME        NOT NULL,
  finished_at     DATETIME        NULL,
  status          ENUM('running','ok','partial','failed','cancelled') NOT NULL DEFAULT 'running',
  items_seen      INT UNSIGNED    NOT NULL DEFAULT 0,
  items_new       INT UNSIGNED    NOT NULL DEFAULT 0,
  items_updated   INT UNSIGNED    NOT NULL DEFAULT 0,
  items_error     INT UNSIGNED    NOT NULL DEFAULT 0,
  error_message   TEXT            NULL,
  meta            JSON            NULL COMMENT 'args, paginación, request counts...',
  PRIMARY KEY (id),
  KEY idx_runs_source_started (source_id, started_at),
  KEY idx_runs_status (status),
  CONSTRAINT fk_runs_source FOREIGN KEY (source_id) REFERENCES sources(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Evento crudo tal como viene de la fuente. payload_hash permite detectar
-- si el evento cambió entre runs sin re-promover innecesariamente.
CREATE TABLE raw_events (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id           SMALLINT UNSIGNED NOT NULL,
  run_id              BIGINT UNSIGNED NOT NULL,
  external_id         VARCHAR(255)    NOT NULL COMMENT 'id del evento en la fuente',
  url                 VARCHAR(1000)   NULL,
  payload             JSON            NOT NULL,
  payload_hash        CHAR(64)        NOT NULL COMMENT 'sha256 del payload normalizado',
  fetched_at          DATETIME        NOT NULL,
  promoted_at         DATETIME        NULL COMMENT 'cuando pasó a ticket_public',
  promoted_event_id   INT UNSIGNED    NULL COMMENT 'id en ticket_public.events (no FK cross-DB)',
  promotion_error     TEXT            NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_raw_source_external_hash (source_id, external_id, payload_hash),
  KEY idx_raw_run (run_id),
  KEY idx_raw_promoted (promoted_at),
  KEY idx_raw_fetched (fetched_at),
  CONSTRAINT fk_raw_source FOREIGN KEY (source_id) REFERENCES sources(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_raw_run FOREIGN KEY (run_id) REFERENCES scraping_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Errores individuales por URL/item dentro de un run
CREATE TABLE scraping_errors (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id          BIGINT UNSIGNED NOT NULL,
  url             VARCHAR(1000)   NULL,
  error_code      VARCHAR(100)    NULL,
  message         TEXT            NOT NULL,
  stack           TEXT            NULL,
  occurred_at     DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_errors_run (run_id),
  KEY idx_errors_occurred (occurred_at),
  CONSTRAINT fk_errors_run FOREIGN KEY (run_id) REFERENCES scraping_runs(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed: fuentes espejo de ticket_public.platforms
INSERT INTO sources (slug, name, kind, base_url) VALUES
  ('taquilla',     'Taquilla.com',             'html', 'https://www.taquilla.com'),
  ('ticketmaster', 'Ticketmaster',             'api',  'https://app.ticketmaster.com/discovery/v2'),
  ('eventbrite',   'Eventbrite',               'api',  'https://www.eventbriteapi.com/v3'),
  ('fever',        'Fever',                    'html', 'https://feverup.com'),
  ('eci',          'El Corte Inglés Entradas', 'html', 'https://www.elcorteingles.es/entradas');
