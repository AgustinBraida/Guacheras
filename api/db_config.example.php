<?php
// ============================================================
// VETFIELD PRO — db_config.EXAMPLE.php
// ► Copiá este archivo como db_config.php y completá los valores.
//   NUNCA subas db_config.php al repositorio (está en .gitignore).
// ============================================================

// ─── Credenciales MySQL ─────────────────────────────────────
define('DB_HOST',    'localhost');
define('DB_NAME',    'u000000000_nombre_bd');
define('DB_USER',    'u000000000_usuario');
define('DB_PASS',    'TU_CONTRASENA_MYSQL');
define('DB_CHARSET', 'utf8mb4');

// ─── Configuración de Email ─────────────────────────────────
// 'php' usa mail() nativo (funciona en la mayoría de hostings).
// 'gmail' usa SMTP de Gmail con App Password (mejor deliverability).
define('MAIL_METHOD',   'php');
define('MAIL_FROM',     'info@tudominio.com');
define('MAIL_FROM_NAME','VETFIELD PRO');
define('MAIL_SMTP_HOST','smtp.gmail.com');
define('MAIL_SMTP_PORT', 587);
define('MAIL_SMTP_USER','tu@gmail.com');
define('MAIL_SMTP_PASS','TU_APP_PASSWORD_GMAIL'); // Contraseña de aplicación Google

// ─── URL base de la aplicación ──────────────────────────────
define('APP_URL', 'https://tudominio.com/');

// ─── Google OAuth ───────────────────────────────────────────
define('GOOGLE_CLIENT_ID',     'TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com');
define('GOOGLE_CLIENT_SECRET', 'TU_GOOGLE_CLIENT_SECRET');
