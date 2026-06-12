<?php
// ============================================================
// VETFIELD PRO — api/reset.php
// Paso 2 del reset de contraseña:
//   → Recibe token + nueva contraseña.
//   → Valida que el token no expiró.
//   → Actualiza password_hash. Limpia el token. Invalida sesiones.
// ============================================================

require_once __DIR__ . '/db_config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'error' => 'Método no permitido.'], 405);
}

$input    = json_decode(file_get_contents('php://input'), true) ?? [];
$token    = trim($input['token']    ?? '');
$password = $input['password']      ?? '';

// Validar inputs
if (strlen($token) < 32) {
    json_response(['ok' => false, 'error' => 'Token inválido o expirado.']);
}

if (strlen($password) < 8 || !preg_match('/[A-Z]/', $password) || !preg_match('/[0-9]/', $password)) {
    json_response(['ok' => false, 'error' => 'La contraseña debe tener mínimo 8 caracteres, una mayúscula y un número.']);
}

$db   = getDB();
$stmt = $db->prepare(
    "SELECT id FROM usuarios
      WHERE token_reset = ?
        AND token_reset_expira > NOW()
        AND status = 'confirmado'"
);
$stmt->execute([$token]);
$user = $stmt->fetch();

if (!$user) {
    json_response(['ok' => false, 'error' => 'El link de reseteo expiró o ya fue usado. Solicitá uno nuevo.']);
}

$hash = password_hash($password, PASSWORD_BCRYPT);

// Actualizar contraseña + limpiar token
$db->prepare(
    "UPDATE usuarios SET password_hash = ?, token_reset = NULL, token_reset_expira = NULL WHERE id = ?"
)->execute([$hash, $user['id']]);

// Invalidar TODAS las sesiones activas (seguridad: si un atacante tenía acceso, lo perdió)
$db->prepare("DELETE FROM sesiones WHERE user_id = ?")->execute([$user['id']]);

json_response([
    'ok'      => true,
    'message' => 'Contraseña restablecida con éxito. Ya podés iniciar sesión con tu nueva contraseña.'
]);
