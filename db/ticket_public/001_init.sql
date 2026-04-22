-- ============================================================================
-- ticket_public — schema inicial
-- DB que lee el front Vercel via Prisma. Datos limpios y normalizados.
-- NUNCA escribir aquí desde scrapers: usar el job de promoción que lee de
-- ticket_scraping.
-- ============================================================================

-- Plataformas de venta
CREATE TABLE platforms (
  id              SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(50)       NOT NULL,
  name            VARCHAR(100)      NOT NULL,
  homepage_url    VARCHAR(500)      NULL,
  logo_url        VARCHAR(500)      NULL,
  active          BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_platforms_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Venues (salas, estadios, auditorios, recintos feriales...)
CREATE TABLE venues (
  id              INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  name            VARCHAR(255)      NOT NULL,
  city            VARCHAR(100)      NOT NULL,
  region          VARCHAR(100)      NULL,
  country         CHAR(2)           NOT NULL DEFAULT 'ES',
  address         VARCHAR(500)      NULL,
  lat             DECIMAL(10, 7)    NULL,
  lng             DECIMAL(10, 7)    NULL,
  created_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_venues_city (city),
  KEY idx_venues_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Eventos canónicos. Un mismo evento real aparece en varias plataformas →
-- 1 fila aquí + N filas en event_listings.
CREATE TABLE events (
  id                INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  slug              VARCHAR(255)    NOT NULL,
  title             VARCHAR(500)    NOT NULL,
  category          ENUM('conciertos','teatro','deportes','festivales','familiar','comedia','otros')
                                    NOT NULL DEFAULT 'otros',
  description       TEXT            NULL,
  image_url         VARCHAR(1000)   NULL,
  event_datetime    DATETIME        NOT NULL COMMENT 'hora local Europe/Madrid',
  doors_open        DATETIME        NULL,
  venue_id          INT UNSIGNED    NULL,
  canonical_key     VARCHAR(128)    NOT NULL COMMENT 'sha1(titulo_normalizado|fecha|venue) para dedup entre plataformas',
  status            ENUM('draft','published','cancelled','past') NOT NULL DEFAULT 'draft',
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_events_slug (slug),
  UNIQUE KEY uk_events_canonical (canonical_key),
  KEY idx_events_datetime (event_datetime),
  KEY idx_events_category (category),
  KEY idx_events_status (status),
  CONSTRAINT fk_events_venue FOREIGN KEY (venue_id) REFERENCES venues(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Listing: un evento disponible en una plataforma concreta.
CREATE TABLE event_listings (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id          INT UNSIGNED    NOT NULL,
  platform_id       SMALLINT UNSIGNED NOT NULL,
  external_id       VARCHAR(255)    NULL COMMENT 'id del evento en la plataforma, para re-scrape',
  url               VARCHAR(1000)   NOT NULL,
  price_min         DECIMAL(10, 2)  NULL,
  price_max         DECIMAL(10, 2)  NULL,
  currency          CHAR(3)         NOT NULL DEFAULT 'EUR',
  availability      ENUM('available','low','sold_out','unknown') NOT NULL DEFAULT 'unknown',
  last_checked_at   DATETIME        NOT NULL,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_listings_event_platform (event_id, platform_id),
  KEY idx_listings_platform (platform_id),
  KEY idx_listings_price_min (price_min),
  KEY idx_listings_checked (last_checked_at),
  CONSTRAINT fk_listings_event FOREIGN KEY (event_id) REFERENCES events(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_listings_platform FOREIGN KEY (platform_id) REFERENCES platforms(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Histórico de precios: necesario para calcular "ahorro" y tendencias.
CREATE TABLE listing_price_history (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id        BIGINT UNSIGNED NOT NULL,
  price_min         DECIMAL(10, 2)  NULL,
  price_max         DECIMAL(10, 2)  NULL,
  availability      ENUM('available','low','sold_out','unknown') NOT NULL DEFAULT 'unknown',
  checked_at        DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_price_history_listing (listing_id, checked_at),
  CONSTRAINT fk_price_history_listing FOREIGN KEY (listing_id) REFERENCES event_listings(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed: plataformas visibles en la maqueta
INSERT INTO platforms (slug, name, homepage_url) VALUES
  ('taquilla',     'Taquilla.com',             'https://www.taquilla.com'),
  ('ticketmaster', 'Ticketmaster',             'https://www.ticketmaster.es'),
  ('eventbrite',   'Eventbrite',               'https://www.eventbrite.es'),
  ('fever',        'Fever',                    'https://feverup.com'),
  ('eci',          'El Corte Inglés Entradas', 'https://www.elcorteingles.es/entradas/');
