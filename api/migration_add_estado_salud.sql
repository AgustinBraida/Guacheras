-- ============================================================
-- VETFIELD PRO — Migración: Agregar columnas de Estado de Salud
-- (Historial de animales que enferman pero no mueren / vivos)
-- Ejecutar en phpMyAdmin de Hostinger
-- ============================================================

ALTER TABLE `registros`
  ADD COLUMN `estado_salud` ENUM(
    'Sano, sin problemas aparentes',
    'Nació con algún problema o malformación',
    'Está enfermo actualmente',
    'Tuvo una enfermedad anteriormente'
  ) NOT NULL DEFAULT 'Sano, sin problemas aparentes'
  COMMENT 'Estado clínico de animales vivos'
  AFTER `estado`,
  ADD COLUMN `detalle_salud` VARCHAR(255) DEFAULT NULL
  COMMENT 'Detalle del problema o enfermedad diagnosticada'
  AFTER `estado_salud`;

-- Verificación:
-- SHOW COLUMNS FROM registros;
