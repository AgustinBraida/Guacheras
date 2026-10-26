<?php
// ============================================================
// VETFIELD PRO — api/informes.php
// Gestión de Informes de Laboratorio (PDFs) en la nube por productor.
// Almacenamiento seguro en disco y metadatos en MySQL.
// Acceso multidispositivo y enlaces directos para WhatsApp.
// ============================================================

require_once __DIR__ . '/db_config.php';

// Si el token vino en POST o GET y no en header (común en multipart)
if (!get_bearer_token() && isset($_REQUEST['token'])) {
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . trim($_REQUEST['token']);
}

$session = validate_session();
if (!$session) {
    json_response(['ok' => false, 'error' => 'Sesión requerida o expirada.'], 401);
}

$uid = $session['id'];
$db  = getDB();

// Asegurar que la tabla exista
ensure_informes_table($db);

$method = $_SERVER['REQUEST_METHOD'];
$action = $_REQUEST['action'] ?? '';

// Si es un POST JSON (ej. delete o update)
if ($method === 'POST' && empty($_POST) && empty($_FILES)) {
    $rawInput = json_decode(file_get_contents('php://input'), true) ?? [];
    if (!empty($rawInput['action'])) {
        $action = $rawInput['action'];
    }
} else {
    $rawInput = [];
}

// ── Enrutamiento ─────────────────────────────────────────────
if ($method === 'GET') {
    switch ($action) {
        case 'list':
            action_list($db, $uid);
            break;
        case 'get_options':
            action_get_options($db, $uid);
            break;
        default:
            json_response(['ok' => false, 'error' => 'Acción GET desconocida.'], 400);
    }
} elseif ($method === 'POST') {
    switch ($action) {
        case 'upload':
            action_upload($db, $uid);
            break;
        case 'delete':
            action_delete($db, $uid, !empty($rawInput) ? $rawInput : $_POST);
            break;
        case 'update':
            action_update($db, $uid, !empty($rawInput) ? $rawInput : $_POST);
            break;
        default:
            json_response(['ok' => false, 'error' => 'Acción POST desconocida.'], 400);
    }
} else {
    json_response(['ok' => false, 'error' => 'Método HTTP no permitido.'], 405);
}

// ============================================================
// SELF-HEALING: Crear tabla si no existe
// ============================================================
function ensure_informes_table(PDO $db): void {
    static $done = false;
    if ($done) return;

    try {
        $db->exec("CREATE TABLE IF NOT EXISTS `informes_laboratorio` (
            `id`              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
            `user_id`         VARCHAR(36)   NOT NULL,
            `productor`       VARCHAR(100)  NOT NULL,
            `titulo`          VARCHAR(200)  NOT NULL,
            `tipo_analisis`   VARCHAR(100)  NOT NULL DEFAULT 'General',
            `fecha`           DATE          NOT NULL,
            `archivo_nombre`  VARCHAR(255)  NOT NULL,
            `archivo_ruta`    VARCHAR(255)  NOT NULL,
            `archivo_url`     VARCHAR(500)  NOT NULL,
            `archivo_tamano`  INT UNSIGNED  NOT NULL DEFAULT 0,
            `notas`           TEXT          DEFAULT NULL,
            `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_inf_user_prod` (`user_id`, `productor`),
            KEY `idx_inf_user_fecha` (`user_id`, `fecha`),
            CONSTRAINT `fk_informes_user`
                FOREIGN KEY (`user_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;");

        // Autosanación de columnas si faltaran
        try {
            $chk = $db->query("SHOW COLUMNS FROM `informes_laboratorio` LIKE 'tipo_analisis'");
            if (!$chk || $chk->rowCount() === 0) {
                $db->exec("ALTER TABLE `informes_laboratorio` ADD COLUMN `tipo_analisis` VARCHAR(100) NOT NULL DEFAULT 'General' AFTER `titulo`");
            }
        } catch (Throwable $e) {}

        $done = true;
    } catch (Throwable $e) {
        // Silenciar si ya existe o hay restricción de permisos
    }
}

// ============================================================
// LIST: Obtiene informes de un productor o todos, más lista de productores
// ============================================================
function action_list(PDO $db, string $uid): void {
    $productor = trim($_GET['productor'] ?? '');

    // 1. Obtener lista completa de productores disponibles para este usuario
    $productores = get_all_available_productores($db, $uid);

    // 2. Obtener informes
    if ($productor !== '') {
        $stmt = $db->prepare("SELECT * FROM `informes_laboratorio` WHERE user_id = ? AND productor = ? ORDER BY fecha DESC, created_at DESC");
        $stmt->execute([$uid, $productor]);
    } else {
        $stmt = $db->prepare("SELECT * FROM `informes_laboratorio` WHERE user_id = ? ORDER BY fecha DESC, created_at DESC");
        $stmt->execute([$uid]);
    }
    $informes = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 3. Conteo de informes por productor
    $stmtCounts = $db->prepare("SELECT productor, COUNT(*) as total FROM `informes_laboratorio` WHERE user_id = ? GROUP BY productor");
    $stmtCounts->execute([$uid]);
    $countsMap = [];
    while ($row = $stmtCounts->fetch(PDO::FETCH_ASSOC)) {
        $countsMap[$row['productor']] = (int)$row['total'];
    }

    json_response([
        'ok'          => true,
        'informes'    => $informes,
        'productores' => $productores,
        'counts_map'  => $countsMap,
        'total'       => count($informes)
    ]);
}

// ============================================================
// UPLOAD: Sube archivo PDF a uploads/informes/ y registra en DB
// ============================================================
function action_upload(PDO $db, string $uid): void {
    // 1. Validar campos de texto
    $productor     = trim($_POST['productor'] ?? '');
    $titulo        = trim($_POST['titulo'] ?? '');
    $tipo_analisis = trim($_POST['tipo_analisis'] ?? 'General');
    $fecha         = trim($_POST['fecha'] ?? '');
    $notas         = trim($_POST['notas'] ?? '');

    if ($productor === '') {
        json_response(['ok' => false, 'error' => 'Debés indicar o seleccionar un productor.'], 400);
    }
    if ($fecha === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
        $fecha = date('Y-m-d');
    }

    // 2. Validar archivo subido
    $file = $_FILES['archivo'] ?? ($_FILES['pdf'] ?? null);
    if (!$file || !isset($file['error'])) {
        json_response(['ok' => false, 'error' => 'No se recibió ningún archivo PDF.'], 400);
    }
    if ($file['error'] !== UPLOAD_ERR_OK) {
        $errMsg = 'Error al subir el archivo.';
        switch ($file['error']) {
            case UPLOAD_ERR_INI_SIZE:
            case UPLOAD_ERR_FORM_SIZE:
                $errMsg = 'El archivo supera el tamaño máximo permitido por el servidor.';
                break;
            case UPLOAD_ERR_PARTIAL:
                $errMsg = 'La subida del archivo se interrumpió.';
                break;
            case UPLOAD_ERR_NO_FILE:
                $errMsg = 'No se seleccionó ningún archivo.';
                break;
        }
        json_response(['ok' => false, 'error' => $errMsg], 400);
    }

    // Límite de tamaño: 25 MB
    $maxBytes = 25 * 1024 * 1024;
    if ($file['size'] > $maxBytes) {
        json_response(['ok' => false, 'error' => 'El PDF no puede superar los 25 MB.'], 400);
    }

    // Validar extensión
    $origName = $file['name'] ?? 'informe.pdf';
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    if ($ext !== 'pdf') {
        json_response(['ok' => false, 'error' => 'Solo se admiten documentos en formato PDF (.pdf).'], 400);
    }

    // Validar cabecera PDF (%PDF-)
    $handle = fopen($file['tmp_name'], 'rb');
    $header = $handle ? fread($handle, 5) : '';
    if ($handle) fclose($handle);
    if ($header !== '%PDF-') {
        json_response(['ok' => false, 'error' => 'El archivo no parece ser un documento PDF válido.'], 400);
    }

    // Si no se proveyó título, usar el nombre original del archivo (sin extensión)
    if ($titulo === '') {
        $titulo = pathinfo($origName, PATHINFO_FILENAME);
        $titulo = str_replace(['_', '-'], ' ', $titulo);
    }

    // 3. Crear directorio de uploads seguro
    $uploadsDir = dirname(__DIR__) . '/uploads/informes/';
    if (!is_dir($uploadsDir)) {
        if (!mkdir($uploadsDir, 0755, true)) {
            json_response(['ok' => false, 'error' => 'No se pudo crear la carpeta de almacenamiento de informes en el servidor.'], 500);
        }
        // Bloquear ejecución de scripts en la carpeta
        file_put_contents($uploadsDir . '.htaccess', "Options -ExecCGI\nAddHandler cgi-script .php .pl .py .sh\n");
    }

    // 4. Generar nombre de archivo único y seguro
    $userSafeId = preg_replace('/[^a-zA-Z0-9]/', '', substr($uid, 0, 8));
    $timestamp  = time();
    $randomHex  = bin2hex(random_bytes(6));
    $storedFilename = "inf_{$userSafeId}_{$timestamp}_{$randomHex}.pdf";
    $targetPath = $uploadsDir . $storedFilename;

    if (!move_uploaded_file($file['tmp_name'], $targetPath)) {
        json_response(['ok' => false, 'error' => 'Error al guardar el archivo en el servidor.'], 500);
    }

    // 5. Construir URL pública absoluta
    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (isset($_SERVER['SERVER_PORT']) && $_SERVER['SERVER_PORT'] == 443) ? 'https://' : 'http://';
    $host = $_SERVER['HTTP_HOST'] ?? 'vetfield.pro';
    $baseUrl = (defined('APP_URL') && APP_URL && !str_contains(APP_URL, 'localhost'))
        ? rtrim(APP_URL, '/')
        : ($protocol . $host);

    $publicUrl = $baseUrl . '/uploads/informes/' . $storedFilename;

    // 6. Guardar en Base de Datos
    $stmt = $db->prepare(
        "INSERT INTO `informes_laboratorio`
         (`user_id`, `productor`, `titulo`, `tipo_analisis`, `fecha`, `archivo_nombre`, `archivo_ruta`, `archivo_url`, `archivo_tamano`, `notas`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    $stmt->execute([
        $uid,
        $productor,
        $titulo,
        $tipo_analisis,
        $fecha,
        $origName,
        $storedFilename,
        $publicUrl,
        (int)$file['size'],
        $notas !== '' ? $notas : null
    ]);

    $newId = (int)$db->lastInsertId();

    // 7. Asegurar que el productor quede registrado en la tabla `productores`
    try {
        $checkProd = $db->prepare("SELECT id FROM `productores` WHERE user_id = ? AND nombre = ? LIMIT 1");
        $checkProd->execute([$uid, $productor]);
        if (!$checkProd->fetch()) {
            $insertProd = $db->prepare("INSERT INTO `productores` (`user_id`, `nombre`) VALUES (?, ?)");
            $insertProd->execute([$uid, $productor]);
        }
    } catch (Throwable $e) {}

    // 8. Recuperar el registro recién insertado
    $stmtGet = $db->prepare("SELECT * FROM `informes_laboratorio` WHERE id = ?");
    $stmtGet->execute([$newId]);
    $informe = $stmtGet->fetch(PDO::FETCH_ASSOC);

    json_response([
        'ok'      => true,
        'informe' => $informe,
        'message' => 'Informe cargado exitosamente en la nube.'
    ]);
}

// ============================================================
// DELETE: Elimina registro y archivo del servidor
// ============================================================
function action_delete(PDO $db, string $uid, array $in): void {
    $id = (int)($in['id'] ?? 0);
    if (!$id) {
        json_response(['ok' => false, 'error' => 'ID de informe inválido.'], 400);
    }

    // Buscar registro para asegurar propiedad y obtener ruta del archivo
    $stmt = $db->prepare("SELECT archivo_ruta FROM `informes_laboratorio` WHERE id = ? AND user_id = ? LIMIT 1");
    $stmt->execute([$id, $uid]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        json_response(['ok' => false, 'error' => 'Informe no encontrado o sin permisos.'], 404);
    }

    // Eliminar archivo en disco
    $filename = basename($row['archivo_ruta']);
    if ($filename !== '') {
        $filePath = dirname(__DIR__) . '/uploads/informes/' . $filename;
        if (file_exists($filePath)) {
            @unlink($filePath);
        }
    }

    // Eliminar de base de datos
    $del = $db->prepare("DELETE FROM `informes_laboratorio` WHERE id = ? AND user_id = ?");
    $del->execute([$id, $uid]);

    json_response(['ok' => true, 'message' => 'Informe eliminado correctamente.']);
}

// ============================================================
// UPDATE: Actualiza metadatos del informe (título, tipo, fecha, notas)
// ============================================================
function action_update(PDO $db, string $uid, array $in): void {
    $id = (int)($in['id'] ?? 0);
    if (!$id) {
        json_response(['ok' => false, 'error' => 'ID de informe inválido.'], 400);
    }

    $titulo        = trim($in['titulo'] ?? '');
    $tipo_analisis = trim($in['tipo_analisis'] ?? 'General');
    $fecha         = trim($in['fecha'] ?? '');
    $notas         = trim($in['notas'] ?? '');

    if ($titulo === '') {
        json_response(['ok' => false, 'error' => 'El título no puede estar vacío.'], 400);
    }

    $stmt = $db->prepare(
        "UPDATE `informes_laboratorio`
         SET titulo = ?, tipo_analisis = ?, fecha = ?, notas = ?
         WHERE id = ? AND user_id = ?"
    );
    $stmt->execute([
        $titulo,
        $tipo_analisis,
        $fecha !== '' ? $fecha : date('Y-m-d'),
        $notas !== '' ? $notas : null,
        $id,
        $uid
    ]);

    json_response(['ok' => true, 'message' => 'Informe actualizado correctamente.']);
}

// ============================================================
// Helper: Obtener lista consolidada de productores de este usuario
// ============================================================
function get_all_available_productores(PDO $db, string $uid): array {
    $set = [];

    // 1. Tabla productores
    try {
        $stmt = $db->prepare("SELECT nombre FROM `productores` WHERE user_id = ?");
        $stmt->execute([$uid]);
        while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $n = trim($r['nombre'] ?? '');
            if ($n !== '') $set[$n] = true;
        }
    } catch (Throwable $e) {}

    // 2. Tabla informes_laboratorio (por si hubiera alguno previo)
    try {
        $stmt = $db->prepare("SELECT DISTINCT productor FROM `informes_laboratorio` WHERE user_id = ?");
        $stmt->execute([$uid]);
        while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $n = trim($r['productor'] ?? '');
            if ($n !== '') $set[$n] = true;
        }
    } catch (Throwable $e) {}

    // 3. Tabla recorridas
    try {
        $stmt = $db->prepare("SELECT DISTINCT productor FROM `recorridas` WHERE user_id = ?");
        $stmt->execute([$uid]);
        while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $n = trim($r['productor'] ?? '');
            if ($n !== '') $set[$n] = true;
        }
    } catch (Throwable $e) {}

    // 4. Tabla registros
    try {
        $stmt = $db->prepare("SELECT DISTINCT productor FROM `registros` WHERE user_id = ?");
        $stmt->execute([$uid]);
        while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $n = trim($r['productor'] ?? '');
            if ($n !== '') $set[$n] = true;
        }
    } catch (Throwable $e) {}

    $list = array_keys($set);
    sort($list, SORT_NATURAL | SORT_FLAG_CASE);
    return $list;
}
