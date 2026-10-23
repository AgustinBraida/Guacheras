<?php
// ============================================================
// VETFIELD PRO — api/recorridas.php
// CRUD de recorridas de campo y seguimiento de pendientes.
// 100% basado en texto y control de hallazgos.
// ============================================================

require_once __DIR__ . '/db_config.php';

$session = validate_session();
if (!$session) {
    json_response(['ok' => false, 'error' => 'Sesión requerida.'], 401);
}

$uid = $session['id'];
$input = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $input['action'] ?? ($_GET['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'];

// Asegurar tabla en base de datos si no existe
ensure_recorridas_table();

// ── Enrutamiento ─────────────────────────────────────────────
if ($method === 'GET') {
    switch ($action) {
        case 'list':
            action_list($uid);
            break;
        case 'pendientes':
            action_pendientes($uid);
            break;
        case 'get_options':
            action_get_options($uid);
            break;
        default:
            json_response(['ok' => false, 'error' => 'Acción GET desconocida.'], 400);
    }
} elseif ($method === 'POST') {
    switch ($action) {
        case 'save':
            action_save($uid, $input);
            break;
        case 'update_status':
            action_update_status($uid, $input);
            break;
        case 'delete':
            action_delete($uid, $input);
            break;
        default:
            json_response(['ok' => false, 'error' => 'Acción POST desconocida.'], 400);
    }
} else {
    json_response(['ok' => false, 'error' => 'Método no permitido.'], 405);
}

// ── Crear tabla si no existe (Self-healing) ──────────────────
function ensure_recorridas_table(): void {
    static $created = false;
    if ($created) return;
    try {
        $db = getDB();
        $db->exec("CREATE TABLE IF NOT EXISTS `recorridas` (
            `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `user_id` VARCHAR(36) NOT NULL,
            `productor` VARCHAR(100) NOT NULL,
            `establecimiento` VARCHAR(100) NOT NULL,
            `fecha` DATE NOT NULL,
            `profesional` VARCHAR(100) DEFAULT NULL,
            `hallazgos` LONGTEXT NOT NULL,
            `resumen_general` TEXT DEFAULT NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_recorridas_user_est` (`user_id`, `establecimiento`, `fecha`),
            KEY `idx_recorridas_user_prod` (`user_id`, `productor`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;");
        $created = true;
    } catch (Exception $e) {
        // Silenciar si falla por permisos, el código cliente tiene fallback en localStorage
    }
}

// ── OPCIONES (productores y establecimientos combinados) ───
function action_get_options(string $uid): void {
    $db = getDB();
    try {
        $productores = [];
        $est_por_productor = [];

        // 1. Obtener productores y sus establecimientos de las tablas principales del sistema
        try {
            $stmt_prod = $db->prepare("SELECT id, nombre FROM productores WHERE user_id = ? ORDER BY nombre ASC");
            $stmt_prod->execute([$uid]);
            $rows_prod = $stmt_prod->fetchAll(PDO::FETCH_ASSOC);

            $prod_map = [];
            foreach ($rows_prod as $p) {
                $p_nombre = trim($p['nombre'] ?? '');
                if ($p_nombre !== '') {
                    if (!in_array($p_nombre, $productores, true)) {
                        $productores[] = $p_nombre;
                    }
                    $prod_map[$p['id']] = $p_nombre;
                    if (!isset($est_por_productor[$p_nombre])) {
                        $est_por_productor[$p_nombre] = [];
                    }
                }
            }

            $stmt_est = $db->prepare("SELECT id_productor, nombre FROM establecimientos WHERE user_id = ? ORDER BY nombre ASC");
            $stmt_est->execute([$uid]);
            $rows_est = $stmt_est->fetchAll(PDO::FETCH_ASSOC);

            foreach ($rows_est as $t) {
                $id_prod = $t['id_productor'];
                $e_nombre = trim($t['nombre'] ?? '');
                if (isset($prod_map[$id_prod]) && $e_nombre !== '') {
                    $p_nombre = $prod_map[$id_prod];
                    if (!isset($est_por_productor[$p_nombre])) {
                        $est_por_productor[$p_nombre] = [];
                    }
                    if (!in_array($e_nombre, $est_por_productor[$p_nombre], true)) {
                        $est_por_productor[$p_nombre][] = $e_nombre;
                    }
                }
            }
        } catch (Exception $eProd) {
            // Continuar con recorridas si fallara alguna tabla
        }

        // 2. Productores y establecimientos únicos que aparecen en recorridas de este usuario
        $stmt_rec = $db->prepare(
            "SELECT DISTINCT productor, establecimiento FROM recorridas WHERE user_id = ? ORDER BY productor ASC, establecimiento ASC"
        );
        $stmt_rec->execute([$uid]);
        $rows_rec = $stmt_rec->fetchAll(PDO::FETCH_ASSOC);

        foreach ($rows_rec as $r) {
            $p = trim($r['productor'] ?? '');
            $e = trim($r['establecimiento'] ?? '');
            if ($p !== '') {
                if (!in_array($p, $productores, true)) {
                    $productores[] = $p;
                }
                if (!isset($est_por_productor[$p])) {
                    $est_por_productor[$p] = [];
                }
                if ($e !== '' && !in_array($e, $est_por_productor[$p], true)) {
                    $est_por_productor[$p][] = $e;
                }
            }
        }

        // Ordenar alfabéticamente
        sort($productores, SORT_NATURAL | SORT_FLAG_CASE);
        foreach ($est_por_productor as $p => &$arr) {
            sort($arr, SORT_NATURAL | SORT_FLAG_CASE);
        }
        unset($arr);

        json_response([
            'ok'                => true,
            'productores'       => $productores,
            'est_por_productor' => $est_por_productor,
        ]);
    } catch (Exception $e) {
        json_response(['ok' => false, 'error' => 'Error al obtener opciones: ' . $e->getMessage()], 500);
    }
}

// ── LISTAR RECORRIDAS ────────────────────────────────────────
function action_list(string $uid): void {
    $db = getDB();
    $productor = trim($_GET['productor'] ?? '');
    $establecimiento = trim($_GET['establecimiento'] ?? '');

    $sql = "SELECT id, productor, establecimiento, fecha, profesional, hallazgos, resumen_general, created_at, updated_at
            FROM recorridas
            WHERE user_id = :uid";
    $params = [':uid' => $uid];

    if ($productor !== '') {
        $sql .= " AND productor = :prod";
        $params[':prod'] = $productor;
    }
    if ($establecimiento !== '') {
        $sql .= " AND establecimiento = :est";
        $params[':est'] = $establecimiento;
    }

    $sql .= " ORDER BY fecha DESC, id DESC";

    try {
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $recorridas = [];
        foreach ($rows as $r) {
            $r['hallazgos'] = json_decode($r['hallazgos'] ?? '[]', true) ?: [];
            $recorridas[] = $r;
        }

        json_response(['ok' => true, 'recorridas' => $recorridas]);
    } catch (Exception $e) {
        json_response(['ok' => false, 'error' => 'Error al consultar recorridas: ' . $e->getMessage()], 500);
    }
}

// ── PENDIENTES ACTIVOS DE UN ESTABLECIMIENTO ─────────────────
function action_pendientes(string $uid): void {
    $db = getDB();
    $establecimiento = trim($_GET['establecimiento'] ?? '');
    $productor = trim($_GET['productor'] ?? '');

    if (!$establecimiento) {
        json_response(['ok' => false, 'error' => 'Establecimiento requerido.'], 400);
    }

    $sql = "SELECT id, productor, establecimiento, fecha, hallazgos
            FROM recorridas
            WHERE user_id = :uid AND establecimiento = :est";
    $params = [':uid' => $uid, ':est' => $establecimiento];

    if ($productor !== '') {
        $sql .= " AND productor = :prod";
        $params[':prod'] = $productor;
    }

    $sql .= " ORDER BY fecha ASC, id ASC";

    try {
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $pendientes = [];
        foreach ($rows as $r) {
            $items = json_decode($r['hallazgos'] ?? '[]', true) ?: [];
            foreach ($items as $item) {
                $esPendiente = !empty($item['es_pendiente']);
                $estado = $item['estado'] ?? 'pendiente';
                if ($esPendiente && in_array($estado, ['pendiente', 'reincidente'])) {
                    $item['recorrida_id'] = $r['id'];
                    $item['fecha_origen'] = $r['fecha'];
                    $pendientes[] = $item;
                }
            }
        }

        json_response(['ok' => true, 'pendientes' => $pendientes]);
    } catch (Exception $e) {
        json_response(['ok' => false, 'error' => 'Error al buscar pendientes: ' . $e->getMessage()], 500);
    }
}

// ── GUARDAR O ACTUALIZAR RECORRIDA ───────────────────────────
function action_save(string $uid, array $in): void {
    $db = getDB();

    $id = isset($in['id']) ? (int)$in['id'] : null;
    $productor = trim($in['productor'] ?? '');
    $establecimiento = trim($in['establecimiento'] ?? '');
    $fecha = trim($in['fecha'] ?? '');
    $profesional = trim($in['profesional'] ?? '');
    $resumen_general = trim($in['resumen_general'] ?? '');
    $hallazgos = is_array($in['hallazgos'] ?? null) ? $in['hallazgos'] : [];

    if (!$productor) json_response(['ok' => false, 'error' => 'El productor es obligatorio.']);
    if (!$establecimiento) json_response(['ok' => false, 'error' => 'El establecimiento es obligatorio.']);
    if (!$fecha || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
        json_response(['ok' => false, 'error' => 'Fecha inválida.']);
    }

    $hallazgosJson = json_encode($hallazgos, JSON_UNESCAPED_UNICODE);

    try {
        // Si no viene ID explícito, buscar si ya existe un registro para
        // este usuario + establecimiento + fecha. Evita duplicados que
        // hacían que los hallazgos borrados volvieran a aparecer.
        if (!$id) {
            $stmtFind = $db->prepare(
                "SELECT id FROM recorridas WHERE user_id = :uid AND establecimiento = :est AND fecha = :fecha LIMIT 1"
            );
            $stmtFind->execute([':uid' => $uid, ':est' => $establecimiento, ':fecha' => $fecha]);
            $existing = $stmtFind->fetch(PDO::FETCH_ASSOC);
            if ($existing) {
                $id = (int)$existing['id'];
            }
        }

        if ($id) {
            // UPDATE: reemplaza completamente los hallazgos (incluye los borrados)
            $sql = "UPDATE recorridas 
                    SET productor = :prod, establecimiento = :est, fecha = :fecha,
                        profesional = :prof, hallazgos = :hal, resumen_general = :res
                    WHERE id = :id AND user_id = :uid";
            $stmt = $db->prepare($sql);
            $stmt->execute([
                ':prod'  => $productor,
                ':est'   => $establecimiento,
                ':fecha' => $fecha,
                ':prof'  => $profesional,
                ':hal'   => $hallazgosJson,
                ':res'   => $resumen_general,
                ':id'    => $id,
                ':uid'   => $uid
            ]);
            _sync_productor_establecimiento($db, $uid, $productor, $establecimiento);
            json_response(['ok' => true, 'id' => $id, 'mensaje' => 'Recorrida actualizada correctamente.']);
        } else {
            // INSERT: primera vez que se guarda esta recorrida hoy
            $sql = "INSERT INTO recorridas (user_id, productor, establecimiento, fecha, profesional, hallazgos, resumen_general)
                    VALUES (:uid, :prod, :est, :fecha, :prof, :hal, :res)";
            $stmt = $db->prepare($sql);
            $stmt->execute([
                ':uid'   => $uid,
                ':prod'  => $productor,
                ':est'   => $establecimiento,
                ':fecha' => $fecha,
                ':prof'  => $profesional,
                ':hal'   => $hallazgosJson,
                ':res'   => $resumen_general
            ]);
            $newId = (int)$db->lastInsertId();
            _sync_productor_establecimiento($db, $uid, $productor, $establecimiento);
            json_response(['ok' => true, 'id' => $newId, 'mensaje' => 'Recorrida guardada con éxito.']);
        }
    } catch (Exception $e) {
        json_response(['ok' => false, 'error' => 'Error al guardar la recorrida: ' . $e->getMessage()], 500);
    }
}

function _sync_productor_establecimiento($db, string $uid, string $productor, string $establecimiento): void {
    try {
        if ($productor === '') return;
        $ins_prod = $db->prepare("INSERT IGNORE INTO productores (user_id, nombre) VALUES (?, ?)");
        $ins_prod->execute([$uid, $productor]);

        if ($establecimiento !== '') {
            $sel_prod = $db->prepare("SELECT id FROM productores WHERE user_id = ? AND nombre = ?");
            $sel_prod->execute([$uid, $productor]);
            $id_prod = $sel_prod->fetchColumn();

            if ($id_prod) {
                $ins_est = $db->prepare("INSERT IGNORE INTO establecimientos (user_id, id_productor, nombre) VALUES (?, ?, ?)");
                $ins_est->execute([$uid, $id_prod, $establecimiento]);
            }
        }
    } catch (Exception $e) {
        // Silencioso para no interferir con la respuesta principal
    }
}

// ── ACTUALIZAR ESTADO DE UN HALLAZGO (Resolver / Reincidente) ─
function action_update_status(string $uid, array $in): void {
    $db = getDB();

    $recorridaId = (int)($in['recorrida_id'] ?? 0);
    $hallazgoId  = trim($in['hallazgo_id'] ?? '');
    $nuevoEstado = trim($in['nuevo_estado'] ?? ''); // 'resuelto', 'pendiente', 'reincidente'

    if (!$recorridaId || !$hallazgoId || !$nuevoEstado) {
        json_response(['ok' => false, 'error' => 'Parámetros incompletos.'], 400);
    }

    try {
        $stmt = $db->prepare("SELECT hallazgos FROM recorridas WHERE id = :id AND user_id = :uid");
        $stmt->execute([':id' => $recorridaId, ':uid' => $uid]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            json_response(['ok' => false, 'error' => 'Recorrida no encontrada.'], 404);
        }

        $items = json_decode($row['hallazgos'] ?? '[]', true) ?: [];
        $found = false;

        foreach ($items as &$it) {
            if (($it['id'] ?? '') === $hallazgoId) {
                $it['estado'] = $nuevoEstado;
                if ($nuevoEstado === 'resuelto') {
                    $it['fecha_resolucion'] = date('Y-m-d');
                } elseif ($nuevoEstado === 'reincidente') {
                    $it['visitas_reincidente'] = ($it['visitas_reincidente'] ?? 0) + 1;
                    $it['ultima_verificacion'] = date('Y-m-d');
                }
                $found = true;
                break;
            }
        }
        unset($it);

        if (!$found) {
            json_response(['ok' => false, 'error' => 'Hallazgo no encontrado en la recorrida.'], 404);
        }

        $stmtUp = $db->prepare("UPDATE recorridas SET hallazgos = :hal WHERE id = :id AND user_id = :uid");
        $stmtUp->execute([
            ':hal' => json_encode($items, JSON_UNESCAPED_UNICODE),
            ':id'  => $recorridaId,
            ':uid' => $uid
        ]);

        json_response(['ok' => true, 'mensaje' => 'Estado actualizado.', 'nuevo_estado' => $nuevoEstado]);
    } catch (Exception $e) {
        json_response(['ok' => false, 'error' => 'Error al actualizar estado: ' . $e->getMessage()], 500);
    }
}

// ── ELIMINAR RECORRIDA ───────────────────────────────────────
function action_delete(string $uid, array $in): void {
    $db = getDB();
    $id = (int)($in['id'] ?? 0);
    if (!$id) json_response(['ok' => false, 'error' => 'ID inválido.'], 400);

    try {
        $stmt = $db->prepare("DELETE FROM recorridas WHERE id = :id AND user_id = :uid");
        $stmt->execute([':id' => $id, ':uid' => $uid]);
        json_response(['ok' => true, 'mensaje' => 'Recorrida eliminada.']);
    } catch (Exception $e) {
        json_response(['ok' => false, 'error' => 'Error al eliminar recorrida: ' . $e->getMessage()], 500);
    }
}
