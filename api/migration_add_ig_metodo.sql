-- ============================================================
-- VETFIELD PRO — Migración: Campo ig_metodo en tabla usuarios
-- Ejecutar en phpMyAdmin para permitir que los clientes elijan
-- entre 'brix' (% Brix) o 'mgdl' (mg/dL) para I.G. Calostro.
-- Por defecto todos los usuarios nuevos y existentes usan 'brix'.
-- ============================================================

ALTER TABLE `usuarios` 
ADD COLUMN `ig_metodo` ENUM('brix', 'mgdl') NOT NULL DEFAULT 'brix' 
AFTER `banner_url`;
