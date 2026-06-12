<?php
// ============================================================
// VETFIELD PRO — Profile Images API
// Guarda/recupera avatar y banner del usuario en el servidor.
// ============================================================

require_once 'db_config.php';

// ── Validar sesión ──────────────────────────────────────────
$user = validate_session();
if (!$user) {
    json_response(['ok' => false, 'error' => 'No autorizado.'], 401);
}

// ── Leer input ───────────────────────────────────────────────
$input  = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $input['action'] ?? '';

switch ($action) {

    // ── SAVE: recibe base64, guarda en disco, actualiza DB ──
    case 'save':
        $type      = $input['type']  ?? '';
        $imageData = $input['image'] ?? '';

        if (!in_array($type, ['avatar', 'banner'], true)) {
            json_response(['ok' => false, 'error' => 'Tipo inválido.'], 400);
        }
        if (empty($imageData)) {
            json_response(['ok' => false, 'error' => 'No se recibió imagen.'], 400);
        }

        // Validar y extraer datos base64
        if (!preg_match('/^data:image\/(jpeg|jpg|png|gif|webp);base64,/i', $imageData)) {
            json_response(['ok' => false, 'error' => 'Formato de imagen inválido. Usá JPG, PNG, GIF o WEBP.'], 400);
        }

        $rawBase64 = substr($imageData, strpos($imageData, ',') + 1);
        $decoded   = base64_decode($rawBase64, true);

        if ($decoded === false || strlen($decoded) < 100) {
            json_response(['ok' => false, 'error' => 'Imagen corrupta o inválida.'], 400);
        }

        // Límite: 5 MB
        if (strlen($decoded) > 5 * 1024 * 1024) {
            json_response(['ok' => false, 'error' => 'La imagen supera el límite de 5 MB.'], 400);
        }

        // ── Crear directorio de uploads ─────────────────────
        // __DIR__ = /public_html/api   →   uploads en /public_html/uploads/
        $uploadsDir = __DIR__ . '/../uploads/profile_images/';
        if (!is_dir($uploadsDir)) {
            if (!mkdir($uploadsDir, 0755, true)) {
                json_response(['ok' => false, 'error' => 'No se pudo crear el directorio de imágenes.'], 500);
            }
            // Bloquear ejecución PHP en la carpeta por seguridad
            file_put_contents($uploadsDir . '.htaccess', "Options -ExecCGI\nAddHandler cgi-script .php .pl .py .sh\n");
        }

        // ── Guardar archivo ─────────────────────────────────
        // Nombre seguro: UUID_tipo.png (sin input del usuario)
        $safeId   = preg_replace('/[^a-zA-Z0-9\-]/', '', $user['id']);
        $filename = $safeId . '_' . $type . '.png';
        $filepath = $uploadsDir . $filename;

        if (file_put_contents($filepath, $decoded) === false) {
            json_response(['ok' => false, 'error' => 'Error al guardar la imagen en el servidor.'], 500);
        }

        // ── URL pública (sin timestamp — el cliente agrega ?v=) ─
        $publicUrl = rtrim(APP_URL, '/') . '/uploads/profile_images/' . $filename;

        // ── Actualizar DB ───────────────────────────────────
        $col  = $type === 'avatar' ? 'avatar_url' : 'banner_url';
        $db   = getDB();
        $stmt = $db->prepare("UPDATE usuarios SET {$col} = :url WHERE id = :id");
        $stmt->execute([':url' => $publicUrl, ':id' => $user['id']]);

        // Devolver URL con timestamp para que el navegador cargue la versión nueva
        json_response(['ok' => true, 'url' => $publicUrl . '?v=' . time()]);
        break;

    // ── GET: devuelve las URLs guardadas en DB ───────────────
    case 'get':
        $db   = getDB();
        $stmt = $db->prepare("SELECT avatar_url, banner_url FROM usuarios WHERE id = :id");
        $stmt->execute([':id' => $user['id']]);
        $row  = $stmt->fetch();

        json_response([
            'ok'         => true,
            'avatar_url' => $row['avatar_url'] ?? null,
            'banner_url' => $row['banner_url'] ?? null,
        ]);
        break;

    default:
        json_response(['ok' => false, 'error' => 'Acción desconocida.'], 400);
}
