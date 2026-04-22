-- ============================================================================
-- 002_tweaks — mantener sources en sync con ticket_public.platforms
-- ============================================================================

UPDATE sources SET slug = 'elcorteingles' WHERE slug = 'eci';
