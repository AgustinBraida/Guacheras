<?php
// ============================================================
// VETFIELD PRO — Diagnóstico de planes y webhook
// IMPORTANTE: Eliminar este archivo del servidor después de usarlo.
// Acceder a: https://vetfield.pro/api/diag_plan.php?secret=diag2024
// ============================================================

if (($_GET['secret'] ?? '') !== 'diag2024') {
    http_response_code(403);
    die('Forbidden');
}

require_once __DIR__ . '/db_config.php';

header('Content-Type: text/plain; charset=utf-8');

echo "=== VETFIELD PRO — Diagnóstico " . date('d/m/Y H:i:s') . " ===\n\n";

// ── 1. Variables de entorno MP ──────────────────────────────
echo "── Mercado Pago Config ──────────────────────\n";
$mp_token   = getenv('MP_ACCESS_TOKEN') ?: '❌ NO CONFIGURADO';
$mp_secret  = getenv('MP_WEBHOOK_SECRET') ?: '❌ NO CONFIGURADO';
$plan_pro_m = getenv('MP_PLAN_ID_PRO_MONTHLY') ?: '❌ NO CONFIGURADO';
$plan_pro_a = getenv('MP_PLAN_ID_PRO_ANNUAL') ?: '❌ NO CONFIGURADO';
$plan_pre_m = getenv('MP_PLAN_ID_PREMIUM_MONTHLY') ?: '❌ NO CONFIGURADO';
$plan_pre_a = getenv('MP_PLAN_ID_PREMIUM_ANNUAL') ?: '❌ NO CONFIGURADO';

// Mostrar solo primeros/últimos chars del token por seguridad
$token_display = strlen($mp_token) > 10
    ? substr($mp_token, 0, 10) . '...' . substr($mp_token, -6)
    : $mp_token;

echo "MP_ACCESS_TOKEN:          $token_display\n";
echo "MP_WEBHOOK_SECRET:        " . (strlen($mp_secret) > 5 ? '✅ Configurado' : $mp_secret) . "\n";
echo "MP_PLAN_ID_PRO_MONTHLY:   $plan_pro_m\n";
echo "MP_PLAN_ID_PRO_ANNUAL:    $plan_pro_a\n";
echo "MP_PLAN_ID_PREMIUM_MONTHLY: $plan_pre_m\n";
echo "MP_PLAN_ID_PREMIUM_ANNUAL:  $plan_pre_a\n\n";

// ── 2. Test API de Mercado Pago ──────────────────────────────
echo "── Test API Mercado Pago ────────────────────\n";
$real_token = getenv('MP_ACCESS_TOKEN');
if ($real_token) {
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "Authorization: Bearer {$real_token}\r\nContent-Type: application/json\r\n",
            'timeout' => 10,
            'ignore_errors' => true,
        ],
    ]);
    $body = @file_get_contents('https://api.mercadopago.com/v1/preapproval_plan?limit=1', false, $ctx);
    $http_status = $http_response_header[0] ?? 'Sin respuesta';
    echo "Endpoint /v1/preapproval_plan: $http_status\n";
    
    if ($body) {
        $data = json_decode($body, true);
        if (isset($data['error'])) {
            echo "❌ Error MP API: " . ($data['message'] ?? $data['error']) . "\n";
        } else {
            echo "✅ API MP responde correctamente\n";
            $total = $data['paging']['total'] ?? 0;
            echo "   Planes encontrados: $total\n";
        }
    } else {
        echo "❌ Sin respuesta de la API de MP\n";
    }
    
    // Buscar suscripciones activas
    echo "\n── Suscripciones autorizadas en MP ──────────\n";
    $body2 = @file_get_contents('https://api.mercadopago.com/preapproval/search?status=authorized&limit=10', false, $ctx);
    $http_status2 = $http_response_header[0] ?? 'Sin respuesta';
    echo "Search endpoint: $http_status2\n";
    if ($body2) {
        $data2 = json_decode($body2, true);
        $results = $data2['results'] ?? [];
        echo "Suscripciones autorizadas: " . count($results) . "\n";
        foreach ($results as $sub) {
            echo "  - ID: " . ($sub['id'] ?? '?') . " | email: " . ($sub['payer_email'] ?? '?') . " | plan_id: " . ($sub['preapproval_plan_id'] ?? '?') . " | status: " . ($sub['status'] ?? '?') . "\n";
        }
    }
    
    // Buscar suscripciones pendientes también
    $body3 = @file_get_contents('https://api.mercadopago.com/preapproval/search?status=pending&limit=10', false, $ctx);
    if ($body3) {
        $data3 = json_decode($body3, true);
        $results3 = $data3['results'] ?? [];
        echo "Suscripciones pendientes: " . count($results3) . "\n";
        foreach ($results3 as $sub) {
            echo "  - ID: " . ($sub['id'] ?? '?') . " | email: " . ($sub['payer_email'] ?? '?') . " | plan_id: " . ($sub['preapproval_plan_id'] ?? '?') . "\n";
        }
    }
} else {
    echo "❌ MP_ACCESS_TOKEN no configurado\n";
}

// ── 3. Estado de usuarios en la BD ──────────────────────────
echo "\n── Usuarios por Plan (BD) ───────────────────\n";
try {
    $db = getDB();
    $stmt = $db->query("SELECT plan, COUNT(*) as total FROM usuarios GROUP BY plan ORDER BY total DESC");
    $rows = $stmt->fetchAll();
    foreach ($rows as $r) {
        $plan_name = $r['plan'] ?? 'NULL (legacy)';
        echo "  Plan '$plan_name': " . $r['total'] . " usuario(s)\n";
    }
    
    echo "\n── Últimos 10 usuarios registrados ──────────\n";
    $stmt2 = $db->query("SELECT email, plan, mp_subscription_id, plan_expires_at, created_at, status FROM usuarios ORDER BY created_at DESC LIMIT 10");
    $users = $stmt2->fetchAll();
    foreach ($users as $u) {
        $mp = $u['mp_subscription_id'] ? substr($u['mp_subscription_id'], 0, 12) . '...' : 'ninguna';
        echo "  {$u['email']} | plan={$u['plan']} | sub=$mp | status={$u['status']} | creado={$u['created_at']}\n";
    }
} catch (Throwable $e) {
    echo "❌ Error BD: " . $e->getMessage() . "\n";
}

// ── 4. Planes pendientes ──────────────────────────────────────
echo "\n── Tabla pending_plans ──────────────────────\n";
try {
    $db = getDB();
    $stmt = $db->query("SELECT email, plan, mp_subscription_id, created_at FROM pending_plans ORDER BY created_at DESC LIMIT 10");
    $rows = $stmt->fetchAll();
    if (count($rows) === 0) {
        echo "  (vacía — ningún pago pendiente de vincular)\n";
    } else {
        foreach ($rows as $r) {
            $mp = $r['mp_subscription_id'] ? substr($r['mp_subscription_id'], 0, 12) . '...' : 'ninguna';
            echo "  {$r['email']} | plan={$r['plan']} | sub=$mp | created={$r['created_at']}\n";
        }
    }
} catch (Throwable $e) {
    echo "❌ Error en pending_plans: " . $e->getMessage() . "\n";
}

echo "\n=== Fin del diagnóstico ===\n";
echo "⚠️  ELIMINAR ESTE ARCHIVO DEL SERVIDOR DESPUÉS DE USARLO\n";
