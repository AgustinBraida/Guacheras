-- ============================================================
-- VETFIELD PRO — Migración: Agregar columna tipo_parto
-- Ejecutar en phpMyAdmin de Hostinger
-- ============================================================

ALTER TABLE `registros`
  ADD COLUMN `tipo_parto` ENUM('Normal','Asistido','Muerto al parto') NOT NULL DEFAULT 'Normal'
  COMMENT 'Tipo de parto: Normal, Asistido o Muerto al parto'
  AFTER `tipo_madre`;

-- Verificación:
-- SHOW COLUMNS FROM registros;
