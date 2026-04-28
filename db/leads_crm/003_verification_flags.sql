-- ============================================================================
-- 003_verification_flags — flags por canal para validación manual
--
-- Cada vez que alguien ve `/promoters` puede abrir un modal y marcar cuál de
-- los canales (web, email, phone, redes) realmente es válido. Permite separar
-- "tenemos un valor" (la URL/email existe) de "ya verificamos que llega y
-- responde". Cada flag es independiente — la persona que valida puede confirmar
-- el email pero todavía no haber probado el teléfono.
-- ============================================================================

ALTER TABLE companies
  ADD COLUMN website_verified   BOOLEAN  NOT NULL DEFAULT FALSE AFTER website,
  ADD COLUMN email_verified     BOOLEAN  NOT NULL DEFAULT FALSE AFTER email,
  ADD COLUMN phone_verified     BOOLEAN  NOT NULL DEFAULT FALSE AFTER phone,
  ADD COLUMN linkedin_verified  BOOLEAN  NOT NULL DEFAULT FALSE AFTER linkedin_url,
  ADD COLUMN instagram_verified BOOLEAN  NOT NULL DEFAULT FALSE AFTER instagram_url,
  ADD COLUMN facebook_verified  BOOLEAN  NOT NULL DEFAULT FALSE AFTER facebook_url,
  ADD COLUMN twitter_verified   BOOLEAN  NOT NULL DEFAULT FALSE AFTER twitter_url,
  ADD COLUMN verified_at        DATETIME NULL;

-- contacts ya tenía email_verified (001_init); ahora también phone_verified.
ALTER TABLE contacts
  ADD COLUMN phone_verified BOOLEAN NOT NULL DEFAULT FALSE AFTER email_verified;

-- Índices opcionales para filtrar rápido en el front "tiene email_verified".
CREATE INDEX idx_companies_email_verified     ON companies(email_verified);
CREATE INDEX idx_companies_instagram_verified ON companies(instagram_verified);
