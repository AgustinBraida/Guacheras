-- ============================================================
-- VETFIELD PRO — Migración a Mercado Pago (versión corregida)
-- Ejecutar UNA SOLA VEZ en phpMyAdmin de Hostinger.
--
-- Esta versión maneja los dos casos posibles:
--   A) La BD nunca tuvo columnas de Lemon → agrega mp_subscription_id directo
--   B) La BD SÍ tenía columnas de Lemon → las reemplaza por mp_subscription_id
-- ============================================================

-- ─── PASO 1: Agregar columna `plan` si no existe ─────────────
-- (puede que ya esté si corriste la migración anterior)

ALTER TABLE `usuarios`
  ADD COLUMN IF NOT EXISTS `plan` VARCHAR(20) NULL DEFAULT NULL
    COMMENT 'NULL=legacy sin límites | inicio | pro | premium'
  AFTER `status`;

-- ─── PASO 2: Agregar mp_subscription_id ──────────────────────
-- Usa ADD COLUMN IF NOT EXISTS para que no falle si ya existe.

ALTER TABLE `usuarios`
  ADD COLUMN IF NOT EXISTS `mp_subscription_id` VARCHAR(100) NULL DEFAULT NULL
    COMMENT 'preapproval_id de Mercado Pago'
  AFTER `plan`;

-- ─── PASO 3: Limpiar columnas de Lemon (si existen) ──────────
-- Si nunca tuviste Lemon configurado, estas líneas no hacen nada.

ALTER TABLE `usuarios`
  DROP COLUMN IF EXISTS `ls_subscription_id`;

ALTER TABLE `usuarios`
  DROP COLUMN IF EXISTS `ls_variant_id`;

-- ─── PASO 4: Crear tabla pending_plans ───────────────────────
-- Guarda planes pagados antes de que el usuario se registre.

CREATE TABLE IF NOT EXISTS `pending_plans` (
  `email`              VARCHAR(150)  NOT NULL,
  `plan`               VARCHAR(20)   NOT NULL,
  `mp_subscription_id` VARCHAR(100)  DEFAULT NULL
    COMMENT 'preapproval_id de Mercado Pago',
  `created_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Planes pagados en MP antes de que el usuario se registre en vetfield.pro';

-- ─── PASO 5: Limpiar columnas LS de pending_plans (si existen)
ALTER TABLE `pending_plans`
  DROP COLUMN IF EXISTS `ls_subscription_id`;

ALTER TABLE `pending_plans`
  DROP COLUMN IF EXISTS `variant_id`;

-- ─── Limpiar cualquier fila residual de prueba ────────────────
DELETE FROM `pending_plans`;

-- ─── VERIFICAR resultado ─────────────────────────────────────
-- Corré estas consultas para confirmar que todo quedó bien:
-- SHOW COLUMNS FROM usuarios;
-- SHOW COLUMNS FROM pending_plans;
-- SELECT id, email, plan, mp_subscription_id, created_at FROM usuarios ORDER BY created_at DESC LIMIT 10;
