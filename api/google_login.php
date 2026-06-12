<?php
// ============================================================
// VETFIELD PRO — api/google_login.php
// Verifica el id_token de Google server-side y crea/actualiza
// el usuario en la BD. Devuelve token de sesión propio.
// ============================================================

require_once __DIR__ . '/db_config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'error' => 'Método no permitido.'], 405);
}

$input    = json_decode(file_get_contents('php://input'), true) ?? [];
$id_token = trim($input['id_token'] ?? '');

if (!$id_token) {
    json_response(['ok' => false, 'error' => 'ID Token requerido.']);
}

// ── Verificar id_token con Google tokeninfo endpoint ─────────────────────────
// Usamos cURL (más fiable que file_get_contents en hosting compartido;
// tiene timeout, verifica SSL, funciona sin allow_url_fopen).
$url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($id_token);
$ch  = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 8,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_USERAGENT      => 'VETFIELD-PRO/1.0',
]);
$response  = curl_exec($ch);
$curl_errno = curl_errno($ch);
$curl_error = curl_error($ch);
curl_close($ch);

if ($response === false || $curl_errno !== 0) {
    error_log('[google_login] cURL error ' . $curl_errno . ': ' . $curl_error);
    json_response(['ok' => false, 'error' => 'No se pudo verificar el token de Google. Intenta de nuevo.']);
}

$google_data = json_decode($response, true);

// Validaciones de seguridad del payload de Google
if (!$google_data || isset($google_data['error'])) {
    json_response(['ok' => false, 'error' => 'Token de Google inválido.']);
}

// Verificar que el token sea para NUESTRA aplicación
if (($google_data['aud'] ?? '') !== GOOGLE_CLIENT_ID) {
    json_response(['ok' => false, 'error' => 'Token no autorizado para esta aplicación.']);
}

// Verificar que el email está verificado por Google
if (($google_data['email_verified'] ?? 'false') !== 'true') {
    json_response(['ok' => false, 'error' => 'El email de Google no está verificado.']);
}

$google_id = $google_data['sub']            ?? '';
$email     = strtolower($google_data['email'] ?? '');
$nombre    = $google_data['name']            ?? $google_data['email'];

if (!$google_id || !$email) {
    json_response(['ok' => false, 'error' => 'Datos insuficientes del perfil de Google.']);
}

$db = getDB();

// ── Buscar usuario por google_id o email ─────────────────────
$stmt = $db->prepare(
    "SELECT id, nombre, email, role, plan, created_at, status
       FROM usuarios
      WHERE google_id = ? OR email = ?
      LIMIT 1"
);
$stmt->execute([$google_id, $email]);
$user = $stmt->fetch();

if ($user) {
    // Usuario existente → actualizar google_id si no lo tenía y confirmar si estaba pendiente
    $db->prepare(
        "UPDATE usuarios SET google_id = ?, status = 'confirmado' WHERE id = ?"
    )->execute([$google_id, $user['id']]);

    $user['status'] = 'confirmado'; // sincronizar en memoria
} else {
    // Usuario nuevo → crear cuenta confirmada con plan 'inicio'
    $id = gen_uuid();
    $db->prepare(
        "INSERT INTO usuarios (id, nombre, email, google_id, status, token_confirmacion, plan)
         VALUES (?, ?, ?, ?, 'confirmado', NULL, 'inicio')"
    )->execute([$id, $nombre, $email, $google_id]);

    // Si ya pagó antes de registrarse, aplicar plan pendiente (inlined para evitar dependencias con auth.php y cache OPcache)
    try {
        $stmt_pending = $db->prepare(
            "SELECT plan, mp_subscription_id
               FROM pending_plans
              WHERE email = ?
              LIMIT 1"
        );
        $stmt_pending->execute([$email]);
        $row_pending = $stmt_pending->fetch();

        if ($row_pending) {
            $db->prepare(
                "UPDATE usuarios
                    SET plan = ?, mp_subscription_id = ?, plan_expires_at = NULL, cancellation_date = NULL
                  WHERE id = ?"
            )->execute([$row_pending['plan'], $row_pending['mp_subscription_id'], $id]);

            $db->prepare("DELETE FROM pending_plans WHERE email = ?")->execute([$email]);
            error_log("[google_login] Plan pendiente '{$row_pending['plan']}' aplicado al registrarse con Google: {$email}");
        }
    } catch (\Throwable $e) {
        error_log("[google_login] Error aplicando pending_plan para {$email}: " . $e->getMessage());
    }

    // Leer el plan final (puede haber cambiado por apply_pending_plan)
    $plan_row = $db->prepare("SELECT plan FROM usuarios WHERE id = ?");
    $plan_row->execute([$id]);
    $assigned_plan = $plan_row->fetchColumn();

    // Notificación WhatsApp de nuevo registro con Google
    $plan_txt = ($assigned_plan === 'inicio') ? 'Inicio (Gratuito)' : strtoupper($assigned_plan);
    send_whatsapp("🐄 VETFIELD PRO\n✅ Nuevo registro creado (Google)\n👤 Nombre: {$nombre}\n📧 Email: {$email}\n📋 Plan: {$plan_txt}\n🕐 " . date('d/m/Y H:i'));

    $user = [
        'id'         => $id,
        'nombre'     => $nombre,
        'email'      => $email,
        'role'       => 'Veterinario de Campo',
        'plan'       => $assigned_plan,
        'created_at' => date('Y-m-d H:i:s'),
        'status'     => 'confirmado',
    ];
}

// ── Crear sesión ─────────────────────────────────────────────
$token      = gen_token();
$expires_at = date('Y-m-d H:i:s', strtotime('+30 days'));
$user_agent = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 300);

$db->prepare(
    "INSERT INTO sesiones (user_id, token, user_agent, expires_at) VALUES (?, ?, ?, ?)"
)->execute([$user['id'], $token, $user_agent, $expires_at]);

json_response([
    'ok'    => true,
    'token' => $token,
    'user'  => [
        'id'         => $user['id'],
        'nombre'     => $user['nombre'],
        'email'      => $user['email'],
        'role'       => $user['role'],
        'plan'       => $user['plan'] ?? null,
        'created_at' => $user['created_at'],
    ]
]);
