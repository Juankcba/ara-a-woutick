-- ============================================================================
-- leads_crm — schema inicial
-- Base B2B para prospección: organizadores, venues, agencias, festivales,
-- ferias, hoteles, recintos feriales. Los scrapers de ticketeras alimentan
-- esta base desde el job de promoción (promoter de TM → companies).
-- ============================================================================

CREATE TABLE companies (
  id              INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(255)     NOT NULL,
  name            VARCHAR(500)     NOT NULL,
  legal_name      VARCHAR(500)     NULL COMMENT 'razón social completa (S.L., S.A.U., ...)',
  category        ENUM(
                    'promoter',          -- organizador de eventos
                    'ticketing',         -- ticketera (Fever, Taquilla, etc.)
                    'venue',             -- sala, estadio, teatro
                    'agency_production', -- agencia de producción de eventos
                    'agency_marketing',  -- agencia de marketing
                    'agency_booking',    -- agencia de booking de artistas
                    'festival',          -- festival (puede ser también promoter)
                    'fair',              -- feria
                    'congress',          -- congreso
                    'hotel',             -- hotel (venta de pack entrada+hotel)
                    'camping',           -- camping (festivales)
                    'venue_complex',     -- recinto ferial (IFEMA, Fira, IFEVI...)
                    'other'
                  ) NOT NULL DEFAULT 'other',
  description     TEXT             NULL,
  website         VARCHAR(500)     NULL,
  email           VARCHAR(255)     NULL,
  phone           VARCHAR(50)      NULL,
  city            VARCHAR(100)     NULL,
  region          VARCHAR(100)     NULL,
  country         CHAR(2)          NOT NULL DEFAULT 'ES',
  address         VARCHAR(500)     NULL,
  tax_id          VARCHAR(50)      NULL COMMENT 'NIF/CIF',
  linkedin_url    VARCHAR(500)     NULL,
  instagram_url   VARCHAR(500)     NULL,
  facebook_url    VARCHAR(500)     NULL,
  twitter_url     VARCHAR(500)     NULL,
  parent_company  VARCHAR(500)     NULL COMMENT 'para agrupar SPVs de un mismo grupo (Live Nation)',
  status          ENUM('new','enriching','enriched','contacted','qualified','won','lost','dnc')
                                   NOT NULL DEFAULT 'new',
  priority        TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0=lowest, 100=highest',
  notes           TEXT             NULL,
  created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_companies_slug (slug),
  KEY idx_companies_category (category),
  KEY idx_companies_city (city),
  KEY idx_companies_status (status),
  KEY idx_companies_parent (parent_company)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE company_sources (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  company_id      INT UNSIGNED     NOT NULL,
  source_platform VARCHAR(50)      NOT NULL COMMENT 'ticketmaster, taquilla, apm_musical, manual, ...',
  external_id     VARCHAR(255)     NULL COMMENT 'id del promoter en la fuente',
  source_url      VARCHAR(1000)    NULL,
  first_seen_at   DATETIME         NOT NULL,
  last_seen_at    DATETIME         NOT NULL,
  events_count    INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT 'cuántos eventos le atribuimos',
  raw             JSON             NULL COMMENT 'snapshot crudo de la fuente',
  PRIMARY KEY (id),
  UNIQUE KEY uk_source_triple (company_id, source_platform, external_id),
  KEY idx_sources_platform (source_platform),
  KEY idx_sources_last_seen (last_seen_at),
  CONSTRAINT fk_sources_company FOREIGN KEY (company_id) REFERENCES companies(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE contacts (
  id              INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  company_id      INT UNSIGNED     NOT NULL,
  full_name       VARCHAR(255)     NULL,
  first_name      VARCHAR(100)     NULL,
  last_name       VARCHAR(100)     NULL,
  role            VARCHAR(255)     NULL COMMENT 'Booking Manager, CEO, Marketing Director, ...',
  email           VARCHAR(255)     NULL,
  phone           VARCHAR(50)      NULL,
  linkedin_url    VARCHAR(500)     NULL,
  source_platform VARCHAR(50)      NULL COMMENT 'apollo, hunter, manual, scraping',
  source_ref      VARCHAR(500)     NULL,
  email_verified  BOOLEAN          NOT NULL DEFAULT FALSE,
  opted_out       BOOLEAN          NOT NULL DEFAULT FALSE COMMENT 'GDPR: pidió no recibir',
  notes           TEXT             NULL,
  created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_contacts_email (email),
  KEY idx_contacts_company (company_id),
  KEY idx_contacts_name (full_name),
  CONSTRAINT fk_contacts_company FOREIGN KEY (company_id) REFERENCES companies(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tags (
  id              SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(50)      NOT NULL,
  name            VARCHAR(100)     NOT NULL,
  color           CHAR(7)          NULL COMMENT 'hex, ej: #ff6600',
  description     VARCHAR(255)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tags_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE company_tags (
  company_id      INT UNSIGNED     NOT NULL,
  tag_id          SMALLINT UNSIGNED NOT NULL,
  added_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id, tag_id),
  KEY idx_company_tags_tag (tag_id),
  CONSTRAINT fk_ct_company FOREIGN KEY (company_id) REFERENCES companies(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ct_tag FOREIGN KEY (tag_id) REFERENCES tags(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed de tags iniciales útiles
INSERT INTO tags (slug, name, color, description) VALUES
  ('big-player',       'Grande',            '#10b981', 'top-tier por volumen de eventos o facturación'),
  ('top-priority',     'Alta prioridad',    '#ef4444', 'objetivo prioritario para outreach'),
  ('needs-enrich',     'Sin contacto',      '#6b7280', 'falta obtener email/teléfono'),
  ('enriched',         'Enriquecido',       '#3b82f6', 'tiene al menos 1 contacto con email verificado'),
  ('madrid',           'Madrid',            '#8b5cf6', 'ubicación Madrid'),
  ('barcelona',        'Barcelona',         '#f59e0b', 'ubicación Barcelona'),
  ('live-nation',      'Live Nation grupo', '#dc2626', 'cualquier SPV del grupo Live Nation España');
