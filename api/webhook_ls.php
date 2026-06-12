<?php
// ============================================================
// VETFIELD PRO — api/webhook_mp.php
// Recibe notificaciones de Mercado Pago y actualiza el plan.
//
// Eventos que maneja:
//   - subscription_preapproval (status: authorized, cancelled, paused, pending)
//   - subscription_authorized_payment (renovación exitosa)
//
// Configuración en Mercado Pago Dashboard:
//   Tus aplicaciones → Tu app → Webhooks → Producción
//   URL: https://vetfield.pro/api/webhook_mp.php
//   Eventos: subscription_preapproval, subscription_authorized_payment
//   Guardar el "Secret de firma" como MP_WEBHOOK_SECRET en el .env
//
// Variables de entorno necesarias en .env:
//   MP_ACCESS_TOKEN=APP_USR-xxxxxxxxxxxxxxxxxxxx
//   MP_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxx
//   MP_PLAN_ID_PRO_MONTHLY=xxxxxxxx
//   MP_PLAN_ID_PRO_ANNUAL=xxxxxxxx
//   MP_PLAN_ID_PREMIUM_MONTHLY=xxxxxxxx
//   MP_PLAN_ID_PREMIUM_ANNUAL=xxxxxxxx
// ============================================================

require_once __DIR__ . '/db_config.php';

// ── 1. Solo POST ─────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit('Method Not Allowed');
}

// ── 2. Leer body RAW ─────────────────────────────────────────
$raw_body = file_get_contents('php://input');

// ── 3. Verificar firma de Mercado Pago ───────────────────────
// Header: x-signature: ts=TIMESTAMP,v1=HMAC_SHA256
$xsig = $_SERVER['HTTP_X_SIGNATURE'] ?? '';
$xreqid = $_SERVER['HTTP_X_REQUEST_ID'] ?? '';
$secret = getenv('MP_WEBHOOK_SECRET');

if ($secret && $xsig) {
    // Parsear ts y v1 del header x-signature
    $ts = '';
    $v1 = '';
    foreach (explode(',', $xsig) as $part) {
        [$k, $v] = explode('=', trim($part), 2) + ['', ''];
        if ($k === 'ts')
            $ts = $v;
        if ($k === 'v1')
            $v1 = $v;
    }

    // Construir el manifest a hashear según spec de MP
    $payload_decoded = json_decode($raw_body, true);
    $data_id = $payload_decoded['data']['id'] ?? '';
    $manifest = "id:{$data_id};request-date:{$ts};";

    $expected = hash_hmac('sha256', $manifest, $secret);

    if (!hash_equals($expected, $v1)) {
        error_log('[webhook_mp] Firma inválida. Ignorando request.');
        http_response_code(401);
        exit('Unauthorized');
    }
} else {
    // Sin secret configurado → solo loguear y aceptar (modo dev/test)
    error_log('[webhook_mp] ATENCIÓN: MP_WEBHOOK_SECRET no configurado. Aceptando sin verificar firma.');
    $payload_decoded = json_decode($raw_body, true);
}

// ── 4. Parsear notificación ──────────────────────────────────
$type = $payload_decoded['type'] ?? '';
$action = $payload_decoded['action'] ?? '';
$data_id = $payload_decoded['data']['id'] ?? '';

if (!$type || !$data_id) {
    error_log('[webhook_mp] Payload inválido: type o data.id ausente.');
    http_response_code(200); // Responder 200 para que MP no reintente
    exit('Ignored: invalid payload');
}

error_log("[webhook_mp] Evento: type={$type} action={$action} data_id={$data_id}");

// ── 5. Mapeo Plan ID → Nombre de plan ───────────────────────
// Completar con los IDs reales después de crear los planes en MP
$PLAN_MAP = [
    getenv('MP_PLAN_ID_PRO_MONTHLY') => 'pro',
    getenv('MP_PLAN_ID_PRO_ANNUAL') => 'pro',
    getenv('MP_PLAN_ID_PREMIUM_MONTHLY') => 'premium',
    getenv('MP_PLAN_ID_PREMIUM_ANNUAL') => 'premium',
];
// Limpiar entradas vacías (variables no configuradas aún)
$PLAN_MAP = array_filter($PLAN_MAP, fn($k) => !empty($k), ARRAY_FILTER_USE_KEY);

// ── 6. Procesar según tipo de evento ────────────────────────
switch ($type) {

    // ── Suscripción creada / actualizada / cancelada
    case 'subscription_preapproval':
        $preapproval = mp_api_get("/preapproval/{$data_id}");
        if (!$preapproval) {
            error_log("[webhook_mp] No se pudo obtener preapproval {$data_id} desde API.");
            break;
        }

        $email = strtolower(trim($preapproval['payer_email'] ?? ''));
        $status = $preapproval['status'] ?? '';
        $plan_id = $preapproval['preapproval_plan_id'] ?? '';
        $mp_sub_id = $preapproval['id'] ?? $data_id;

        error_log("[webhook_mp] preapproval: email={$email} status={$status} plan_id={$plan_id}");

        if (in_array($status, ['authorized', 'pending'], true)) {
            $plan = $PLAN_MAP[$plan_id] ?? null;
            if ($plan && $email) {
                set_user_plan_by_email($email, $plan, $mp_sub_id);
            } else {
                error_log("[webhook_mp] Plan no mapeado para plan_id={$plan_id} o email vacío.");
            }
        }

        if (in_array($status, ['cancelled', 'paused'], true)) {
            if ($email) {
                $expires_at = $preapproval['next_payment_date'] ?? null;
                if (!$expires_at) {
                    $expires_at = date('Y-m-d H:i:s');
                } else {
                    $expires_at = date('Y-m-d H:i:s', strtotime($expires_at));
                }
                set_user_cancellation_by_email($email, $mp_sub_id, $expires_at);
            }
        }
        break;

    // ── Pago de renovación aprobado (confirma que la sub sigue activa)
    case 'subscription_authorized_payment':
        $payment = mp_api_get("/authorized_payments/{$data_id}");
        if (!$payment) {
            error_log("[webhook_mp] No se pudo obtener authorized_payment {$data_id}.");
            break;
        }

        $preapproval_id = $payment['preapproval_id'] ?? '';
        if (!$preapproval_id) {
            error_log('[webhook_mp] authorized_payment sin preapproval_id.');
            break;
        }

        $preapproval = mp_api_get("/preapproval/{$preapproval_id}");
        if (!$preapproval)
            break;

        $email = strtolower(trim($preapproval['payer_email'] ?? ''));
        $plan_id = $preapproval['preapproval_plan_id'] ?? '';
        $mp_sub_id = $preapproval['id'] ?? $preapproval_id;

        $plan = $PLAN_MAP[$plan_id] ?? null;
        if ($plan && $email) {
            set_user_plan_by_email($email, $plan, $mp_sub_id);
            error_log("[webhook_mp] Renovación procesada: email={$email} plan={$plan}");
        }
        break;

    default:
        error_log("[webhook_mp] Tipo de evento no manejado: {$type}");
}

http_response_code(200);
echo json_encode(['ok' => true]);
exit;

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

/**
 * Consulta la API de Mercado Pago y retorna el array del recurso,
 * o null si hay un error.
 */
function mp_api_get(string $path): ?array
{
    $token = getenv('MP_ACCESS_TOKEN');
    if (!$token) {
        error_log('[webhook_mp] MP_ACCESS_TOKEN no configurado.');
        return null;
    }

    $url = 'https://api.mercadopago.com/v1' . $path;
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
            'timeout' => 10,
        ],
    ]);

    $body = @file_get_contents($url, false, $ctx);
    if ($body === false) {
        error_log("[webhook_mp] Error de red al consultar MP API: {$url}");
        return null;
    }

    $data = json_decode($body, true);
    if (!$data || isset($data['error'])) {
        error_log("[webhook_mp] Error de MP API ({$url}): " . ($data['message'] ?? 'desconocido'));
        return null;
    }

    return $data;
}

/**
 * Actualiza el plan del usuario por email.
 * Si el usuario no existe aún, guarda en pending_plans para
 * aplicarlo cuando se registre (flujo: primero paga, después se registra).
 */
function set_user_plan_by_email(string $email, string $plan, string $mp_subscription_id): void
{
    $db = getDB();

    $stmt = $db->prepare("SELECT id FROM usuarios WHERE email = ?");
    $stmt->execute([$email]);
    $user_id = $stmt->fetchColumn();

    if ($user_id) {
        $upd = $db->prepare(
            "UPDATE usuarios
             SET plan = ?, mp_subscription_id = ?, plan_expires_at = NULL, cancellation_date = NULL
             WHERE id = ?"
        );
        $upd->execute([$plan, $mp_subscription_id, $user_id]);
        error_log("[webhook_mp] Plan '{$plan}' asignado a usuario existente: {$email}");
    } else {
        $ins = $db->prepare(
            "INSERT INTO pending_plans (email, plan, mp_subscription_id)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
               plan = VALUES(plan),
               mp_subscription_id = VALUES(mp_subscription_id),
               created_at = NOW()"
        );
        $ins->execute([$email, $plan, $mp_subscription_id]);
        error_log("[webhook_mp] Plan '{$plan}' guardado en pending_plans para: {$email}");
    }

    // Notificación WhatsApp de plan de pago
    $plan_upper = strtoupper($plan);
    $user_status = $user_id ? "Usuario registrado" : "Pendiente de registro (email)";
    send_whatsapp("🐄 VETFIELD PRO\n💳 Pago aprobado / Suscripción activa\n📧 Email: {$email}\n⭐ Plan: {$plan_upper}\n📌 Estado: {$user_status}\n🕐 " . date('d/m/Y H:i'));
}

/**
 * Registra la cancelación o pausa, estableciendo la fecha de expiración del plan.
 * El veterinario conserva el acceso hasta esa fecha de expiración.
 */
function set_user_cancellation_by_email(string $email, string $mp_subscription_id, string $expires_at): void
{
    $db = getDB();
    $db->prepare(
        "UPDATE usuarios
            SET plan_expires_at = ?, cancellation_date = NOW()
          WHERE email = ? AND mp_subscription_id = ?"
    )->execute([$expires_at, $email, $mp_subscription_id]);
    error_log("[webhook_mp] Cancelación/pausa procesada para: {$email} (sub: {$mp_subscription_id}, expira: {$expires_at})");
}
