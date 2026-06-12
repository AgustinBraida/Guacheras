-- ============================================================
-- VETFIELD PRO — SQL completo para ejecutar en phpMyAdmin
-- Ejecutar en orden, una sola vez.
-- ============================================================

-- ─── PASO 1: Agregar columna `plan` a usuarios ───────────────
-- NULL = usuario legacy (existentes, sin límites)
-- 'inicio' = plan gratuito (nuevos registros)
-- 'pro' / 'premium' = pagos

ALTER TABLE `usuarios`
  ADD COLUMN `plan` VARCHAR(20) NULL DEFAULT NULL
    COMMENT 'NULL=legacy sin límites | inicio | pro | premium'
  AFTER `status`;

-- ─── PASO 2: Agregar columnas de suscripción a usuarios ──────
-- Guardan el ID de suscripción de Lemon Squeezy y el variant ID
-- para poder manejar renovaciones y cancelaciones.

ALTER TABLE `usuarios`
  ADD COLUMN `ls_subscription_id` VARCHAR(100) NULL DEFAULT NULL
    COMMENT 'ID de suscripción de Lemon Squeezy'
  AFTER `plan`;

ALTER TABLE `usuarios`
  ADD COLUMN `ls_variant_id` INT NULL DEFAULT NULL
    COMMENT 'Variant ID de Lemon Squeezy para identificar el plan'
  AFTER `ls_subscription_id`;

-- ─── PASO 3: Crear tabla pending_plans ───────────────────────
-- Guarda planes pre-pagados de usuarios que aún no se registraron.
-- El webhook de LS escribe aquí cuando no encuentra la cuenta.
-- Al registrarse, auth.php lee esta tabla y aplica el plan.

CREATE TABLE IF NOT EXISTS `pending_plans` (
  `email`                VARCHAR(150)  NOT NULL,
  `plan`                 VARCHAR(20)   NOT NULL,
  `variant_id`           INT           DEFAULT NULL,
  `ls_subscription_id`   VARCHAR(100)  DEFAULT NULL,
  `created_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Planes pagados en LS antes de que el usuario se registre en vetfield.pro';

-- ─── VERIFICAR resultado ────────────────────────────────────
-- Corré estas consultas para confirmar que todo quedó bien:
-- SELECT id, email, plan, ls_subscription_id, created_at FROM usuarios ORDER BY created_at DESC LIMIT 10;
-- SHOW COLUMNS FROM usuarios;
-- SHOW COLUMNS FROM pending_plans;
