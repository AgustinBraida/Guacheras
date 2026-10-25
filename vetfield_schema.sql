-- ============================================================
-- VETFIELD PRO — Database Schema v1.0
-- Importar directamente en phpMyAdmin de Hostinger
-- Codificación: utf8mb4 (soporta emojis y caracteres especiales)
-- ============================================================

SET SQL_MODE   = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone  = "+00:00";

-- ─── TABLA: usuarios ────────────────────────────────────────
-- Almacena cuentas locales y cuentas vinculadas con Google.
-- status = 'pendiente' → no puede ingresar hasta confirmar email.
-- status = 'confirmado' → acceso completo.
CREATE TABLE IF NOT EXISTS `usuarios` (
  `id`                   VARCHAR(36)   NOT NULL                COMMENT 'UUID generado en PHP',
  `nombre`               VARCHAR(100)  NOT NULL,
  `email`                VARCHAR(150)  NOT NULL,
  `password_hash`        VARCHAR(255)  DEFAULT NULL            COMMENT 'NULL para cuentas Google-only',
  `google_id`            VARCHAR(100)  DEFAULT NULL            COMMENT 'sub de Google OAuth, NULL si no vinculado',
  `role`                 VARCHAR(50)   NOT NULL DEFAULT 'Veterinario de Campo',
  `status`               ENUM('pendiente','confirmado') NOT NULL DEFAULT 'pendiente',
  `token_confirmacion`   VARCHAR(64)   DEFAULT NULL            COMMENT 'Token UUID para activar cuenta por email',
  `token_reset`          VARCHAR(64)   DEFAULT NULL            COMMENT 'Token SHA256 para resetear contraseña',
  `token_reset_expira`   DATETIME      DEFAULT NULL            COMMENT 'Expiración del token de reset (2 horas)',
  `avatar_url`           VARCHAR(500)  DEFAULT NULL            COMMENT 'URL pública del avatar subido al servidor',
  `banner_url`           VARCHAR(500)  DEFAULT NULL            COMMENT 'URL pública del banner subido al servidor',
  `ig_metodo`            ENUM('brix','mgdl') NOT NULL DEFAULT 'brix' COMMENT 'Preferencia medición I.G. Calostro: brix (% Brix) o mgdl (mg/dL)',
  `lugares_muerte`       TEXT          DEFAULT NULL            COMMENT 'JSON array con lugares de muerte configurados y activos',
  `dashboard_config`     TEXT          DEFAULT NULL            COMMENT 'JSON con orden de gráficos y títulos del dashboard',
  `plan`                 VARCHAR(50)   NOT NULL DEFAULT 'inicio' COMMENT 'Plan de suscripción: inicio, pro, premium',
  `mp_subscription_id`   VARCHAR(100)  DEFAULT NULL            COMMENT 'ID de suscripción de Mercado Pago',
  `plan_expires_at`      DATETIME      DEFAULT NULL            COMMENT 'Fecha de fin de ciclo al cancelar suscripción',
  `cancellation_date`    DATETIME      DEFAULT NULL            COMMENT 'Fecha en que el usuario solicitó cancelar',
  `created_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email`     (`email`),
  UNIQUE KEY `uq_google_id` (`google_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── MIGRACIÓN: Si la tabla `usuarios` ya existe, ejecutar estas líneas ────
-- ALTER TABLE `usuarios` ADD COLUMN `avatar_url` VARCHAR(500) DEFAULT NULL COMMENT 'URL pública del avatar subido al servidor';
-- ALTER TABLE `usuarios` ADD COLUMN `banner_url` VARCHAR(500) DEFAULT NULL COMMENT 'URL pública del banner subido al servidor';
-- ALTER TABLE `usuarios` ADD COLUMN `ig_metodo` ENUM('brix','mgdl') NOT NULL DEFAULT 'brix' COMMENT 'Preferencia medición I.G. Calostro';
-- ALTER TABLE `usuarios` ADD COLUMN `lugares_muerte` TEXT DEFAULT NULL COMMENT 'JSON array con lugares de muerte configurados';
-- ALTER TABLE `usuarios` ADD COLUMN `dashboard_config` TEXT DEFAULT NULL COMMENT 'JSON con orden de gráficos y títulos del dashboard';
-- ALTER TABLE `usuarios` ADD COLUMN `plan` VARCHAR(50) NOT NULL DEFAULT 'inicio' COMMENT 'Plan de suscripción';
-- ALTER TABLE `usuarios` ADD COLUMN `mp_subscription_id` VARCHAR(100) DEFAULT NULL COMMENT 'ID suscripción Mercado Pago';
-- ALTER TABLE `usuarios` ADD COLUMN `plan_expires_at` DATETIME DEFAULT NULL COMMENT 'Vencimiento de plan cancelado';
-- ALTER TABLE `usuarios` ADD COLUMN `cancellation_date` DATETIME DEFAULT NULL COMMENT 'Fecha de solicitud de cancelación';


-- ─── TABLA: sesiones ────────────────────────────────────────
-- Token por dispositivo/navegador. Soporta uso simultáneo en
-- múltiples equipos. Se invalida en logout o al expirar.
CREATE TABLE IF NOT EXISTS `sesiones` (
  `id`         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `user_id`    VARCHAR(36)   NOT NULL,
  `token`      VARCHAR(64)   NOT NULL                         COMMENT 'Token generado con bin2hex(random_bytes(32))',
  `user_agent` VARCHAR(300)  DEFAULT NULL                     COMMENT 'Info del navegador para mostrar sesiones activas',
  `created_at` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME      NOT NULL                         COMMENT 'DEFAULT: 30 días después del login',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_token` (`token`),
  KEY `idx_user_id`  (`user_id`),
  KEY `idx_expires`  (`expires_at`),
  CONSTRAINT `fk_sesiones_user`
    FOREIGN KEY (`user_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── TABLA: registros ───────────────────────────────────────
-- Registros de guacheras. SIEMPRE filtrados por user_id.
CREATE TABLE IF NOT EXISTS `registros` (
  `id`              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `user_id`         VARCHAR(36)   NOT NULL,
  `productor`       VARCHAR(100)  NOT NULL,
  `establecimiento` VARCHAR(100)  DEFAULT NULL,
  `fecha`           DATE          NOT NULL,
  `rp_ternero`      VARCHAR(50)   DEFAULT NULL,
  `ig_ternero`      DECIMAL(5,2)  DEFAULT NULL,
  `sexo`            ENUM('Macho','Hembra') NOT NULL DEFAULT 'Macho',
  `ombligo`         ENUM('Bueno','Regular','Malo') NOT NULL DEFAULT 'Bueno',
  `tipo_madre`      ENUM('Vaca','Vaquillona') NOT NULL DEFAULT 'Vaca',
  `tipo_parto`      ENUM('Normal','Asistido','Muerto al parto') NOT NULL DEFAULT 'Normal',
  `rp_madre`        VARCHAR(50)   DEFAULT NULL,
  `litros_calostro_madre`  DECIMAL(5,2) DEFAULT NULL               COMMENT 'Cantidad de litros de calostro de la madre',
  `tipo_calostro`   ENUM('De la madre','Banco de calostro','Calostro mejorado') NOT NULL DEFAULT 'De la madre',
  `metodo_calostrado` ENUM('Con mamadera','Con sonda','Mamó solo') NOT NULL DEFAULT 'Con mamadera',
  `ig_calostro`     DECIMAL(5,2)  DEFAULT NULL,
  `estado`          VARCHAR(60)   NOT NULL DEFAULT 'Vivo',
  `estado_salud`    ENUM('Sano, sin problemas aparentes','Nació con algún problema o malformación','Está enfermo actualmente','Tuvo una enfermedad anteriormente') DEFAULT NULL,
  `detalle_salud`   VARCHAR(255)  DEFAULT NULL,
  `causa`           TEXT          DEFAULT NULL,
  `causa_categoria` VARCHAR(100)  DEFAULT NULL,
  `causa_especifica` VARCHAR(100)  DEFAULT NULL,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_fecha`           (`user_id`, `fecha`),
  KEY `idx_user_establecimiento` (`user_id`, `establecimiento`),
  CONSTRAINT `fk_registros_user`
    FOREIGN KEY (`user_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── MIGRACIÓN REGISTROS: Si la tabla `registros` ya existe, ejecutar estas líneas ──
-- ALTER TABLE `registros` MODIFY COLUMN `estado_salud` ENUM('Sano, sin problemas aparentes','Nació con algún problema o malformación','Está enfermo actualmente','Tuvo una enfermedad anteriormente') DEFAULT NULL;
-- ALTER TABLE `registros` ADD COLUMN IF NOT EXISTS `litros_calostro_madre` DECIMAL(5,2) DEFAULT NULL AFTER `rp_madre`;
-- ALTER TABLE `registros` ADD COLUMN IF NOT EXISTS `causa_categoria` VARCHAR(100) DEFAULT NULL AFTER `causa`;
-- ALTER TABLE `registros` ADD COLUMN IF NOT EXISTS `causa_especifica` VARCHAR(100) DEFAULT NULL AFTER `causa_categoria`;


-- ─── TABLA: productores ──────────────────────────────────────
-- Entidad principal. Alimenta los selectores del formulario.
CREATE TABLE IF NOT EXISTS `productores` (
  `id`      INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `user_id` VARCHAR(36)   NOT NULL,
  `nombre`  VARCHAR(100)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_productor_user` (`user_id`, `nombre`),
  CONSTRAINT `fk_productores_user`
    FOREIGN KEY (`user_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── TABLA: establecimientos ─────────────────────────────────
-- Depende de Productor (Relación 1:N).
CREATE TABLE IF NOT EXISTS `establecimientos` (
  `id`           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `user_id`      VARCHAR(36)   NOT NULL,
  `id_productor` INT UNSIGNED  NOT NULL,
  `nombre`       VARCHAR(100)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_establecimiento_productor` (`user_id`, `id_productor`, `nombre`),
  CONSTRAINT `fk_establecimientos_user`
    FOREIGN KEY (`user_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_establecimientos_productor`
    FOREIGN KEY (`id_productor`) REFERENCES `productores` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── TABLA: recorridas ───────────────────────────────────────
-- Bitácora de recorridas de guacheras, observaciones de campo y seguimiento de pendientes.
CREATE TABLE IF NOT EXISTS `recorridas` (
  `id`              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `user_id`         VARCHAR(36)   NOT NULL,
  `productor`       VARCHAR(100)  NOT NULL,
  `establecimiento` VARCHAR(100)  NOT NULL,
  `fecha`           DATE          NOT NULL,
  `profesional`     VARCHAR(100)  DEFAULT NULL,
  `hallazgos`       LONGTEXT      NOT NULL COMMENT 'Array JSON con hallazgos, estado (pendiente/resuelto/reincidente) y categoría',
  `resumen_general` TEXT          DEFAULT NULL,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_recorridas_user_est`  (`user_id`, `establecimiento`, `fecha`),
  KEY `idx_recorridas_user_prod` (`user_id`, `productor`),
  CONSTRAINT `fk_recorridas_user`
    FOREIGN KEY (`user_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── TABLA: pending_plans ────────────────────────────────────
-- Planes pagados en Mercado Pago previos al registro del usuario con ese email.
CREATE TABLE IF NOT EXISTS `pending_plans` (
  `id`                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `email`              VARCHAR(150)  NOT NULL,
  `plan`               VARCHAR(50)   NOT NULL,
  `mp_subscription_id` VARCHAR(100)  DEFAULT NULL,
  `created_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pending_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

