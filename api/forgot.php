<?php
// ============================================================
// VETFIELD PRO — api/forgot.php
// Paso 1 del reset de contraseña:
//   → Recibe email, genera token seguro, envía link por email.
//   → Siempre responde con éxito (evita enumerar usuarios).
// ============================================================

require_once __DIR__ . '/db_config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'error' => 'Método no permitido.'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$email = strtolower(trim($input['email'] ?? ''));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response(['ok' => false, 'error' => 'Email inválido.']);
}

// Rate limiting: 5 solicitudes por IP cada 10 minutos
$ip = rl_get_client_ip();
if (rl_get_fails($ip, 'forgot', RL_FORGOT_WIN) >= RL_FORGOT_MAX)
    json_response(['ok' => false, 'error' => 'Demasiadas solicitudes. Esperá 10 minutos.'], 429);
rl_increment($ip, 'forgot', RL_FORGOT_WIN);


$db   = getDB();
$stmt = $db->prepare("SELECT id, nombre FROM usuarios WHERE email = ? AND status = 'confirmado'");
$stmt->execute([$email]);
$user = $stmt->fetch();

// Respuesta neutra para evitar user enumeration
$neutral = ['ok' => true, 'message' => 'Si el email está registrado, recibirás un link para restablecer tu contraseña.'];

if (!$user) {
    // No revelar si el email existe o no
    json_response($neutral);
}

// Generar token seguro con expiración de 2 horas
$token   = gen_token();
$expira  = date('Y-m-d H:i:s', strtotime('+2 hours'));

$up = $db->prepare(
    "UPDATE usuarios SET token_reset = ?, token_reset_expira = ? WHERE id = ?"
);
$up->execute([$token, $expira, $user['id']]);

// Enviar email con link de reseteo
$link    = APP_URL . '/?reset_token=' . $token;
$nombre  = htmlspecialchars($user['nombre']);
$content = "Hola <strong>{$nombre}</strong>,<br><br>
Recibimos una solicitud para restablecer la contraseña de tu cuenta de VETFIELD PRO.<br><br>
Hacé click en el botón de abajo para crear una nueva contraseña. <strong>Este link es válido por 2 horas.</strong><br><br>
Si no solicitaste este cambio, podés ignorar este email — tu contraseña permanecerá sin cambios.";

$html = email_template(
    'Restablecer tu contraseña',
    $content,
    'Crear nueva contraseña',
    $link
);

send_email($email, $user['nombre'], 'Restablecer contraseña de VETFIELD PRO', $html);

json_response($neutral);
