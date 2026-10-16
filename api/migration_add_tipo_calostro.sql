-- ============================================================
-- VETFIELD PRO — Migración: Agregar columna tipo_calostro
-- Ejecutar en phpMyAdmin de Hostinger
-- ============================================================

ALTER TABLE `registros`
  ADD COLUMN `tipo_calostro` ENUM('De la madre','Banco de calostro','Calostro mejorado') NOT NULL DEFAULT 'De la madre'
  COMMENT 'Tipo de calostro: De la madre, Banco de calostro o Calostro mejorado'
  AFTER `rp_madre`;

-- Verificación:
-- SHOW COLUMNS FROM registros;
