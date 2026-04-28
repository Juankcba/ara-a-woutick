-- ============================================================================
-- 005_descartado_status — distinguir "no investigado" (empty) de "investigado y
-- descartado por X razón" (descartado).
--
-- Hasta ahora todo lo que no estaba en producción era 'empty', incluso los
-- sitios que ya habían sido escaneados y no eran viables (B2B SaaS, geolocked,
-- iframe legacy, etc). El admin no diferenciaba entre "todavía no lo miré" y
-- "ya miré y no se puede". Esta migración agrega el estado 'descartado' para
-- que el admin muestre tres categorías limpias.
-- ============================================================================

ALTER TABLE sources
  MODIFY COLUMN config_status ENUM('empty','draft','tested','production','descartado')
    NOT NULL DEFAULT 'empty';
