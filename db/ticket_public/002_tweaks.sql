-- ============================================================================
-- 002_tweaks — venue dedup + platform slug sync con el front
-- ============================================================================

-- Dedup de venues por (name, city). Fuzzy matching lo dejamos para más tarde.
ALTER TABLE venues
  ADD UNIQUE KEY uk_venues_name_city (name, city);

-- El front hardcodea 'elcorteingles' como slug. Sincronizamos DB para evitar mapping innecesario.
UPDATE platforms SET slug = 'elcorteingles' WHERE slug = 'eci';
