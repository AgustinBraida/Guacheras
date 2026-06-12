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
  `created_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email`     (`email`),
  UNIQUE KEY `uq_google_id` (`google_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── MIGRACIÓN: Si la tabla `usuarios` ya existe, ejecutar estas líneas ────
-- ALTER TABLE `usuarios` ADD COLUMN `avatar_url` VARCHAR(500) DEFAULT NULL COMMENT 'URL pública del avatar subido al servidor';
-- ALTER TABLE `usuarios` ADD COLUMN `banner_url` VARCHAR(500) DEFAULT NULL COMMENT 'URL pública del banner subido al servidor';


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
  `rp_madre`        VARCHAR(50)   DEFAULT NULL,
  `ig_calostro`     DECIMAL(5,2)  DEFAULT NULL,
  `estado`          VARCHAR(60)   NOT NULL DEFAULT 'Vivo',
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
