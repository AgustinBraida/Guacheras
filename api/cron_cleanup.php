<?php
// ============================================================
// VETFIELD PRO — api/cron_cleanup.php
// Limpia datos de usuarios cuya suscripción expiró hace > 2 meses (60 días)
// ============================================================

require_once __DIR__ . '/db_config.php';

// Solo permitir ejecución local (CLI) o vía web mediante un token secreto
// Configurar este token en el .env como CRON_TOKEN o usar el default de respaldo
$cron_token = getenv('CRON_TOKEN') ?: 'vetfield_cron_secret_123';
$req_token = $_GET['token'] ?? '';

if (php_sapi_name() !== 'cli' && $req_token !== $cron_token) {
    http_response_code(403);
    exit('Acceso denegado: Token de seguridad incorrecto.');
}

try {
    $db = getDB();
    
    // Obtener los IDs de usuarios que tienen el plan expirado hace más de 60 días
    // 60 días en MySQL: DATE_SUB(NOW(), INTERVAL 60 DAY)
    $stmt = $db->query("
        SELECT id, nombre, email 
          FROM usuarios 
         WHERE plan_expires_at IS NOT NULL 
           AND plan_expires_at < DATE_SUB(NOW(), INTERVAL 60 DAY)
    ");
    $expired_users = $stmt->fetchAll();

    $count = 0;
    foreach ($expired_users as $user) {
        $user_id = $user['id'];
        
        $db->beginTransaction();
        try {
            // Eliminar registros, establecimientos y productores asociados
            $db->prepare("DELETE FROM registros WHERE user_id = ?")->execute([$user_id]);
            $db->prepare("DELETE FROM establecimientos WHERE user_id = ?")->execute([$user_id]);
            $db->prepare("DELETE FROM productores WHERE user_id = ?")->execute([$user_id]);
            
            // Reiniciar campos de suscripción de la cuenta
            $db->prepare("
                UPDATE usuarios 
                   SET plan = 'inicio', 
                       mp_subscription_id = NULL, 
                       plan_expires_at = NULL,
                       cancellation_date = NULL
                 WHERE id = ?
            ")->execute([$user_id]);
            
            $db->commit();
            $count++;
            error_log("[cron_cleanup] Datos limpiados automáticamente por inactividad (>60 días): {$user['email']} (ID: {$user_id})");
        } catch (\Throwable $e) {
            $db->rollBack();
            error_log("[cron_cleanup] Error al limpiar datos para el usuario {$user_id}: " . $e->getMessage());
        }
    }

    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => true,
        'message' => 'Proceso de limpieza completado.',
        'processed_users_count' => $count
    ]);
} catch (\Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'Error en el servidor: ' . $e->getMessage()
    ]);
}
