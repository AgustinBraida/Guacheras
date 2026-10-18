-- ============================================================
-- VETFIELD PRO — Migración: Agregar columna metodo_calostrado
-- Ejecutar en phpMyAdmin de Hostinger
-- ============================================================

ALTER TABLE `registros`
  ADD COLUMN `metodo_calostrado` ENUM('Con mamadera','Con sonda','Mamó solo') NOT NULL DEFAULT 'Con mamadera'
  COMMENT 'Método de calostrado: Con mamadera, Con sonda o Mamó solo'
  AFTER `tipo_calostro`;

-- Verificación:
-- SHOW COLUMNS FROM registros;
