<?php
// ============================================================
// VETFIELD PRO — api/auth.php
// Maneja: register, confirm, login, logout, get_session,
//         update_profile
// ============================================================

require_once __DIR__ . '/db_config.php';

// Procesar petición si se accede directamente a este script
if (isset($_SERVER['SCRIPT_FILENAME']) && strtolower(basename($_SERVER['SCRIPT_FILENAME'])) === 'auth.php') {
    // Leer body JSON
    $input  = json_decode(file_get_contents('php://input'), true) ?? [];
    $action = $input['action'] ?? ($_GET['action'] ?? '');

    // ── Rutas GET permitidas ─────────────────────────────────────
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if ($action === 'confirm') {
            action_confirm_email();
        } elseif ($action === 'get_session') {
            // Compatibilidad con versiones anteriores del cliente JS
            action_get_session();
        } else {
            json_response(['ok' => false, 'error' => 'Método no permitido.'], 405);
        }
        exit;
    }

    // ── Rutas POST ───────────────────────────────────────────────
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        json_response(['ok' => false, 'error' => 'Método no permitido.'], 405);
    }

    switch ($action) {
        case 'register':            action_register($input);            break;
        case 'login':               action_login($input);               break;
        case 'logout':              action_logout();                    break;
        case 'get_session':         action_get_session();               break;
        case 'update_profile':      action_update_profile($input);      break;
        case 'cancel_subscription': action_cancel_subscription();        break;
        default:
            json_response(['ok' => false, 'error' => 'Acción desconocida.'], 400);
    }
}

// (Rate Limiting centralizado en db_config.php)

// ============================================================
// REGISTER
// ============================================================
function action_register(array $in): void {
    $nombre   = trim($in['nombre'] ?? '');
    $email    = strtolower(trim($in['email'] ?? ''));
    $password = $in['password'] ?? '';

    // Validaciones básicas
    if (strlen($nombre) < 2)
        json_response(['ok' => false, 'error' => 'El nombre debe tener al menos 2 caracteres.']);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))
        json_response(['ok' => false, 'error' => 'Email inválido.']);
    if (strlen($password) < 8 || !preg_match('/[A-Z]/', $password) || !preg_match('/[0-9]/', $password))
        json_response(['ok' => false, 'error' => 'La contraseña debe tener mínimo 8 caracteres, una mayúscula y un número.']);

    // Rate limiting por IP (prevenir registro masivo)
    $ip = rl_get_client_ip();
    if (rl_get_fails($ip, 'register', RL_REGISTER_WIN) >= RL_REGISTER_MAX)
        json_response(['ok' => false, 'error' => 'Demasiados registros desde esta IP. Esperá 5 minutos.'], 429);
    rl_increment($ip, 'register', RL_REGISTER_WIN);

    $db = getDB();

    // Verificar unicidad de email
    $chk = $db->prepare("SELECT id FROM usuarios WHERE email = ?");
    $chk->execute([$email]);
    if ($chk->fetch())
        json_response(['ok' => false, 'error' => 'Ya existe una cuenta con ese email.']);

    $id                = gen_uuid();
    $hash              = password_hash($password, PASSWORD_BCRYPT);
    $token_confirmacion = gen_token();

    $stmt = $db->prepare(
        "INSERT INTO usuarios (id, nombre, email, password_hash, status, token_confirmacion, plan)
         VALUES (?, ?, ?, ?, 'pendiente', ?, 'inicio')"
    );
    $stmt->execute([$id, $nombre, $email, $hash, $token_confirmacion]);

    // Si el usuario ya pagó antes de registrarse, aplicar ese plan
    apply_pending_plan($db, $id, $email);

    // Notificación WhatsApp de nuevo registro
    $final_plan = 'inicio';
    try {
        $stmt_plan = $db->prepare("SELECT plan FROM usuarios WHERE id = ?");
        $stmt_plan->execute([$id]);
        $plan_db = $stmt_plan->fetchColumn();
        if ($plan_db) {
            $final_plan = $plan_db;
        }
    } catch (\Throwable $e) {}
    $plan_txt = ($final_plan === 'inicio') ? 'Inicio (Gratuito)' : strtoupper($final_plan);
    send_whatsapp("🐄 VETFIELD PRO\n✅ Nuevo registro creado\n👤 Nombre: {$nombre}\n📧 Email: {$email}\n📋 Plan: {$plan_txt}\n🕐 " . date('d/m/Y H:i'));

    // Enviar email de confirmación
    $link    = APP_URL . '/api/auth.php?action=confirm&token=' . $token_confirmacion;
    $content = "Hola <strong>{$nombre}</strong>,<br><br>
Gracias por registrarte en VETFIELD PRO. Solo falta un paso: confirmá tu dirección de email para activar tu cuenta.";
    $html = email_template(
        '¡Bienvenido a VETFIELD PRO!',
        $content,
        'Confirmar mi cuenta',
        $link
    );

    send_email($email, $nombre, 'Confirmá tu cuenta de VETFIELD PRO', $html);

    json_response([
        'ok'      => true,
        'message' => 'Cuenta creada. Revisá tu email (' . $email . ') para confirmar tu cuenta antes de ingresar.'
    ]);
}

// ============================================================
// CONFIRM EMAIL (GET — link del email)
// ============================================================
function action_confirm_email(): void {
    $token = trim($_GET['token'] ?? '');
    if (strlen($token) < 32) {
        http_response_code(400);
        // Redirigir con error visible
        header('Location: ' . APP_URL . '/index?auth_msg=token_invalido');
        exit;
    }

    $db   = getDB();
    $stmt = $db->prepare("SELECT id FROM usuarios WHERE token_confirmacion = ? AND status = 'pendiente'");
    $stmt->execute([$token]);
    $user = $stmt->fetch();

    if (!$user) {
        header('Location: ' . APP_URL . '/index?auth_msg=token_invalido');
        exit;
    }

    $up = $db->prepare(
        "UPDATE usuarios SET status = 'confirmado', token_confirmacion = NULL WHERE id = ?"
    );
    $up->execute([$user['id']]);

    header('Location: ' . APP_URL . '/index?auth_msg=confirmado');
    exit;
}

// ============================================================
// LOGIN
// ============================================================
function action_login(array $in): void {
    $email    = strtolower(trim($in['email'] ?? ''));
    $password = $in['password'] ?? '';

    if (!$email || !$password)
        json_response(['ok' => false, 'error' => 'Completá todos los campos.']);

    // ─ Rate limiting ───────────────────────────────────────
    $ip = rl_get_client_ip();
    if (rl_get_fails($ip, $email) >= RL_MAX_FAILS) {
        json_response(['ok' => false, 'error' => 'Demasiados intentos fallidos. Esperá 5 minutos antes de volver a intentar.'], 429);
    }

    $db   = getDB();
    $stmt = $db->prepare(
        "SELECT id, nombre, email, password_hash, role, status, plan, created_at, mp_subscription_id, plan_expires_at FROM usuarios WHERE email = ?"
    );
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    // Proteger contra timing attacks — siempre verificar hash aunque no exista el usuario
    $dummy_hash = '$2y$10$invalidhashtopreventtimingattack12345678901234567890';
    $hash       = $user['password_hash'] ?? $dummy_hash;
    $valid      = password_verify($password, $hash);

    if (!$user || !$valid) {
        rl_increment($ip, $email); // contabilizar intento fallido
        json_response(['ok' => false, 'error' => 'Email o contraseña incorrectos.']);
    }

    if ($user['status'] !== 'confirmado') {
        json_response(['ok' => false, 'error' => 'Tu cuenta aún no fue confirmada. Revisá tu email.']);
    }

    // Login exitoso — resetear contador
    rl_reset($ip, $email);

    // Crear sesión
    $token      = gen_token();
    $expires_at = date('Y-m-d H:i:s', strtotime('+30 days'));
    $user_agent = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 300);

    $db->prepare(
        "INSERT INTO sesiones (user_id, token, user_agent, expires_at) VALUES (?, ?, ?, ?)"
    )->execute([$user['id'], $token, $user_agent, $expires_at]);

    json_response([
        'ok'  => true,
        'token' => $token,
        'user' => [
            'id'         => $user['id'],
            'nombre'     => $user['nombre'],
            'email'      => $user['email'],
            'role'       => $user['role'],
            'plan'       => $user['plan'],   // null = legacy (sin límites), 'inicio' = plan gratuito
            'created_at' => $user['created_at'],
            'has_mp_subscription' => !empty($user['mp_subscription_id']),
            'plan_expires_at' => $user['plan_expires_at'],
        ]
    ]);
}

// ============================================================
// LOGOUT
// ============================================================
function action_logout(): void {
    $token = get_bearer_token();
    if ($token) {
        $db = getDB();
        $db->prepare("DELETE FROM sesiones WHERE token = ?")->execute([$token]);
    }
    json_response(['ok' => true]);
}

// ============================================================
// GET SESSION (validar token al cargar la app)
// ============================================================
function action_get_session(): void {
    $user = validate_session();
    if (!$user) {
        json_response(['ok' => false, 'error' => 'Sesión inválida o expirada.'], 401);
    }
    json_response([
        'ok' => true,
        'user' => [
            'id'         => $user['id'],
            'nombre'     => $user['nombre'],
            'email'      => $user['email'],
            'role'       => $user['role'],
            'plan'       => $user['plan'],
            'created_at' => $user['created_at'],
            'has_mp_subscription' => !empty($user['mp_subscription_id']),
            'plan_expires_at' => $user['plan_expires_at'],
        ]
    ]);
}

// ============================================================
// UPDATE PROFILE
// ============================================================
function action_update_profile(array $in): void {
    $session = validate_session();
    if (!$session) json_response(['ok' => false, 'error' => 'Sin sesión activa.'], 401);

    $nombre   = trim($in['nombre'] ?? '');
    $email    = strtolower(trim($in['email'] ?? ''));
    $password = $in['password'] ?? '';

    if (strlen($nombre) < 2)
        json_response(['ok' => false, 'error' => 'El nombre debe tener al menos 2 caracteres.']);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))
        json_response(['ok' => false, 'error' => 'Email inválido.']);

    $db = getDB();

    // Verificar que el email no le pertenezca a otro usuario
    $chk = $db->prepare("SELECT id FROM usuarios WHERE email = ? AND id != ?");
    $chk->execute([$email, $session['id']]);
    if ($chk->fetch())
        json_response(['ok' => false, 'error' => 'Ese email ya está en uso por otra cuenta.']);

    if ($password && strlen($password) > 0) {
        if (strlen($password) < 8 || !preg_match('/[A-Z]/', $password) || !preg_match('/[0-9]/', $password))
            json_response(['ok' => false, 'error' => 'La contraseña debe tener mínimo 8 caracteres, una mayúscula y un número.']);

        $hash  = password_hash($password, PASSWORD_BCRYPT);
        $stmt  = $db->prepare("UPDATE usuarios SET nombre = ?, email = ?, password_hash = ? WHERE id = ?");
        $stmt->execute([$nombre, $email, $hash, $session['id']]);
    } else {
        $stmt  = $db->prepare("UPDATE usuarios SET nombre = ?, email = ? WHERE id = ?");
        $stmt->execute([$nombre, $email, $session['id']]);
    }

    // Devolver datos actualizados
    $updated = $db->prepare("SELECT id, nombre, email, role, plan, created_at, mp_subscription_id, plan_expires_at FROM usuarios WHERE id = ?");
    $updated->execute([$session['id']]);
    $user = $updated->fetch();

    json_response([
        'ok' => true,
        'user' => [
            'id'         => $user['id'],
            'nombre'     => $user['nombre'],
            'email'      => $user['email'],
            'role'       => $user['role'],
            'plan'       => $user['plan'],
            'created_at' => $user['created_at'],
            'has_mp_subscription' => !empty($user['mp_subscription_id']),
            'plan_expires_at' => $user['plan_expires_at'],
        ]
    ]);
}

// ============================================================
// HELPER: Aplicar plan pendiente si el usuario ya pagó antes
// de crear su cuenta (el webhook guardó el plan en pending_plans).
// ============================================================
function apply_pending_plan(PDO $db, string $user_id, string $email): void {
    try {
        $stmt = $db->prepare(
            "SELECT plan, mp_subscription_id
               FROM pending_plans
              WHERE email = ?
              LIMIT 1"
        );
        $stmt->execute([$email]);
        $row = $stmt->fetch();

        if (!$row) return;

        // Actualizar el plan del usuario recién creado
        $db->prepare(
            "UPDATE usuarios
                SET plan = ?, mp_subscription_id = ?, plan_expires_at = NULL, cancellation_date = NULL
              WHERE id = ?"
        )->execute([$row['plan'], $row['mp_subscription_id'], $user_id]);

        // Limpiar el registro pendiente
        $db->prepare("DELETE FROM pending_plans WHERE email = ?")->execute([$email]);

        error_log("[auth] Plan pendiente '{$row['plan']}' aplicado al registrarse: {$email}");
    } catch (\Throwable $e) {
        // No bloquear el registro si falla esta parte
        error_log("[auth] Error aplicando pending_plan para {$email}: " . $e->getMessage());
    }
}

// ============================================================
// CANCEL SUBSCRIPTION (MERCADO PAGO)
// ============================================================
function action_cancel_subscription(): void {
    $session = validate_session();
    if (!$session) {
        json_response(['ok' => false, 'error' => 'Sin sesión activa.'], 401);
    }

    $db = getDB();
    // Obtener mp_subscription_id directamente del usuario
    $stmt = $db->prepare("SELECT mp_subscription_id, plan FROM usuarios WHERE id = ?");
    $stmt->execute([$session['id']]);
    $user_row = $stmt->fetch();

    if (!$user_row || !$user_row['mp_subscription_id']) {
        json_response(['ok' => false, 'error' => 'No tenés una suscripción activa de Mercado Pago para cancelar de forma automática. Contáctanos por WhatsApp para ayudarte.']);
    }

    $mp_sub_id = $user_row['mp_subscription_id'];
    $next_payment_iso = mp_api_cancel_subscription($mp_sub_id);

    if (!$next_payment_iso) {
        json_response(['ok' => false, 'error' => 'No se pudo cancelar la suscripción en Mercado Pago. Por favor, reintentá o contactanos por WhatsApp.']);
    }

    // Convertir formato ISO de Mercado Pago a DATETIME de MySQL
    $expires_at = date('Y-m-d H:i:s', strtotime($next_payment_iso));

    // Actualizar plan_expires_at y cancellation_date en la base de datos
    // NOTA: Se mantiene el plan actual ('pro' o 'premium') para que siga usando la web
    // con privilegios premium. validate_session() lo degradará dinámicamente cuando expire.
    $upd = $db->prepare("UPDATE usuarios SET plan_expires_at = ?, cancellation_date = NOW() WHERE id = ?");
    $upd->execute([$expires_at, $session['id']]);

    // Obtener datos actualizados del usuario
    $updated = $db->prepare("SELECT id, nombre, email, role, plan, created_at, mp_subscription_id, plan_expires_at FROM usuarios WHERE id = ?");
    $updated->execute([$session['id']]);
    $user = $updated->fetch();

    json_response([
        'ok' => true,
        'message' => 'Tu suscripción fue cancelada con éxito. Conservarás acceso premium hasta el ' . date('d/m/Y', strtotime($expires_at)) . '.',
        'user' => [
            'id' => $user['id'],
            'nombre' => $user['nombre'],
            'email' => $user['email'],
            'role' => $user['role'],
            'plan' => $user['plan'],
            'created_at' => $user['created_at'],
            'has_mp_subscription' => !empty($user['mp_subscription_id']),
            'plan_expires_at' => $user['plan_expires_at'],
        ]
    ]);
}

/**
 * Llama a la API de Mercado Pago para cambiar el estado de la suscripción a 'cancelled'.
 * Retorna la fecha del próximo cobro ('next_payment_date') o null si hay error.
 */
function mp_api_cancel_subscription(string $preapproval_id): ?string
{
    $token = getenv('MP_ACCESS_TOKEN');
    if (!$token) {
        error_log('[auth_cancel] MP_ACCESS_TOKEN no configurado.');
        return null;
    }

    $url = 'https://api.mercadopago.com/v1/preapproval/' . $preapproval_id;
    $data = json_encode(['status' => 'cancelled']);
    
    $ctx = stream_context_create([
        'http' => [
            'method' => 'PUT',
            'header' => "Authorization: Bearer {$token}\r\n" .
                        "Content-Type: application/json\r\n" .
                        "Content-Length: " . strlen($data) . "\r\n",
            'content' => $data,
            'timeout' => 15,
            'ignore_errors' => true // Permite leer el cuerpo de la respuesta en errores HTTP
        ],
    ]);

    $response = @file_get_contents($url, false, $ctx);
    if ($response === false) {
        error_log("[auth_cancel] Error de red al cancelar suscripción {$preapproval_id}");
        return null;
    }

    $res_data = json_decode($response, true);
    if (!$res_data) {
        error_log("[auth_cancel] Respuesta no válida al cancelar suscripción {$preapproval_id}: {$response}");
        return null;
    }

    if (isset($res_data['error']) || (isset($res_data['status']) && $res_data['status'] !== 'cancelled')) {
        $message = $res_data['message'] ?? '';
        // Si ya estaba cancelada o es un cambio de estado inválido por ya estar cancelada, consideramos éxito y devolvemos la fecha actual
        if (str_contains(strtolower($message), 'cancelled') || str_contains(strtolower($message), 'cancelada') || str_contains(strtolower($message), 'invalid status change')) {
            return date('Y-m-d H:i:s');
        }
        error_log("[auth_cancel] Error retornado por MP al cancelar suscripción {$preapproval_id}: " . json_encode($res_data));
        return null;
    }

    return $res_data['next_payment_date'] ?? date('Y-m-d H:i:s');
}
