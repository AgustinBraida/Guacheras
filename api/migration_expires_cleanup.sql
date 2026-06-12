-- ============================================================
-- VETFIELD PRO — Migración de Expiración y Cancelación de Suscripción
-- Ejecutar en la base de datos de producción (phpMyAdmin de Hostinger).
-- ============================================================

ALTER TABLE `usuarios`
  ADD COLUMN IF NOT EXISTS `plan_expires_at` DATETIME DEFAULT NULL 
    COMMENT 'Fecha en que finaliza el acceso pagado actual (fin de ciclo)'
    AFTER `mp_subscription_id`,
  ADD COLUMN IF NOT EXISTS `cancellation_date` DATETIME DEFAULT NULL 
    COMMENT 'Fecha en que el usuario solicitó la cancelación'
    AFTER `plan_expires_at`;
