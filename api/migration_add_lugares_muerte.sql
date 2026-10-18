-- ============================================================
-- VETFIELD PRO — Migración: Campo lugares_muerte en tabla usuarios
-- Ejecutar en phpMyAdmin para permitir que los clientes personalicen
-- y activen/desactiven los lugares de muerte de los terneros.
-- ============================================================

ALTER TABLE `usuarios` 
ADD COLUMN `lugares_muerte` TEXT DEFAULT NULL 
AFTER `ig_metodo`;
