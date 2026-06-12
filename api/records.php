<?php
// ============================================================
// VETFIELD PRO — api/records.php
// CRUD de registros de establecimientos.
// TODOS los queries llevan WHERE user_id = ? — aislamiento total.
// ============================================================

require_once __DIR__ . '/db_config.php';

$session = validate_session();
if (!$session) {
    json_response(['ok' => false, 'error' => 'Sesión requerida.'], 401);
}

$uid    = $session['id'];
// Guardar la sesión completa en $GLOBALS para que las funciones
// internas puedan acceder al plan sin re-consultar la BD.
$GLOBALS['_vf_session'] = $session;

$input  = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $input['action'] ?? ($_GET['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'];

// ── Enrutamiento ─────────────────────────────────────────────
if ($method === 'GET') {
    switch ($action) {
        case 'list':          action_list($uid);          break;
        case 'get_options':   action_get_options($uid);   break;
        case 'backup_export': action_backup_export($uid); break;
        default:
            json_response(['ok' => false, 'error' => 'Acción GET desconocida.'], 400);
    }
} elseif ($method === 'POST') {
    switch ($action) {
        case 'save':          action_save($uid, $input);   break;
        case 'update':        action_update($uid, $input); break;
        case 'delete':        action_delete($uid, $input); break;
        case 'backup_import': action_backup_import($uid, $input); break;
        default:
            json_response(['ok' => false, 'error' => 'Acción POST desconocida.'], 400);
    }
} else {
    json_response(['ok' => false, 'error' => 'Método no permitido.'], 405);
}

// ============================================================
// UPDATE — Actualizar un registro existente
// ============================================================
function action_update(string $uid, array $in): void {
    $db = getDB();

    $id = (int)($in['id'] ?? 0);
    if (!$id) json_response(['ok' => false, 'error' => 'ID de registro inválido.']);

    $productor = trim($in['productor'] ?? '');
    $fecha = trim($in['fecha'] ?? '');
    
    if (!$productor) json_response(['ok' => false, 'error' => 'El campo Productor es obligatorio.']);
    if (!$fecha || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha))
        json_response(['ok' => false, 'error' => 'Fecha inválida.']);

    $ig_ternero  = is_numeric($in['ig_ternero']  ?? null) ? (float)$in['ig_ternero']  : null;
    $ig_calostro = is_numeric($in['ig_calostro'] ?? null) ? (float)$in['ig_calostro'] : null;

    $stmt = $db->prepare(
        "UPDATE registros
         SET establecimiento = :establecimiento,
             fecha = :fecha,
             productor = :productor,
             rp_ternero = :rp_ternero,
             ig_ternero = :ig_ternero,
             sexo = :sexo,
             ombligo = :ombligo,
             tipo_madre = :tipo_madre,
             rp_madre = :rp_madre,
             ig_calostro = :ig_calostro,
             estado = :estado,
             causa = :causa,
             causa_categoria = :causa_cat,
             causa_especifica = :causa_esp
         WHERE id = :id AND user_id = :uid"
    );

    $stmt->execute([
        ':id'              => $id,
        ':uid'             => $uid,
        ':productor'       => $productor,
        ':establecimiento' => trim($in['establecimiento'] ?? '') ?: null,
        ':fecha'           => $fecha,
        ':rp_ternero'      => trim($in['rp_ternero']  ?? '') ?: null,
        ':ig_ternero'      => $ig_ternero,
        ':sexo'            => in_array($in['sexo'] ?? '', ['Macho','Hembra']) ? $in['sexo'] : 'Macho',
        ':ombligo'         => in_array($in['ombligo'] ?? '', ['Bueno','Regular','Malo']) ? $in['ombligo'] : 'Bueno',
        ':tipo_madre'      => in_array($in['tipo_madre'] ?? '', ['Vaca','Vaquillona']) ? $in['tipo_madre'] : 'Vaca',
        ':rp_madre'        => trim($in['rp_madre']    ?? '') ?: null,
        ':ig_calostro'     => $ig_calostro,
        ':estado'          => trim($in['estado']      ?? 'Vivo'),
        ':causa'           => trim($in['causa']        ?? '') ?: null,
        ':causa_cat'       => trim($in['causa_categoria'] ?? '') ?: null,
        ':causa_esp'       => trim($in['causa_especifica'] ?? '') ?: null,
    ]);

    if ($stmt->rowCount() === 0) {
        // Podría ser que no cambió nada o que el registro no existe
        // Verificamos si existe
        $check = $db->prepare("SELECT COUNT(*) FROM registros WHERE id = ? AND user_id = ?");
        $check->execute([$id, $uid]);
        if ($check->fetchColumn() == 0) {
            json_response(['ok' => false, 'error' => 'Registro no encontrado o sin permisos.'], 403);
        }
    }

    json_response(['ok' => true]);
}

// ============================================================
// LIST — Listar registros del usuario con filtros opcionales
// ============================================================
function action_list(string $uid): void {
    $db = getDB();

    $establecimiento     = $_GET['establecimiento']     ?? '';
    $productor = $_GET['productor'] ?? '';
    $fecha     = $_GET['fecha']     ?? '';

    $sql    = "SELECT * FROM registros WHERE user_id = :uid";
    $params = [':uid' => $uid];

    if ($establecimiento) {
        $sql .= " AND establecimiento = :establecimiento";
        $params[':establecimiento'] = $establecimiento;
    }
    if ($productor) {
        $sql .= " AND productor = :productor";
        $params[':productor'] = $productor;
    }
    if ($fecha && preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
        $sql .= " AND fecha = :fecha";
        $params[':fecha'] = $fecha;
    }

    $sql .= " ORDER BY created_at DESC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $records = $stmt->fetchAll();

    // Normalizar campos numéricos para el frontend
    foreach ($records as &$r) {
        $r['ig_ternero']  = $r['ig_ternero']  !== null ? (float)$r['ig_ternero']  : null;
        $r['ig_calostro'] = $r['ig_calostro'] !== null ? (float)$r['ig_calostro'] : null;
        $r['synced']      = true; // Viniendo de la BD siempre están "synced"
    }
    unset($r);

    json_response(['ok' => true, 'records' => $records]);
}

// ============================================================
// GET OPTIONS — Establecimientos y productores
// Devuelve lista de productores y mapa de establecimientos por productor
// ============================================================
function action_get_options(string $uid): void {
    $db   = getDB();
    
    $stmt_prod = $db->prepare("SELECT id, nombre FROM productores WHERE user_id = ? ORDER BY nombre ASC");
    $stmt_prod->execute([$uid]);
    $productores_rows = $stmt_prod->fetchAll();
    
    $stmt_establecimiento = $db->prepare("SELECT id_productor, nombre FROM establecimientos WHERE user_id = ? ORDER BY nombre ASC");
    $stmt_establecimiento->execute([$uid]);
    $establecimientos_rows = $stmt_establecimiento->fetchAll();

    $productores = [];
    $establecimientos_flat = [];
    $establecimientos_por_productor = [];
    
    $prod_map = [];
    foreach ($productores_rows as $p) {
        $productores[] = $p['nombre'];
        $prod_map[$p['id']] = $p['nombre'];
        $establecimientos_por_productor[$p['nombre']] = [];
    }
    
    foreach ($establecimientos_rows as $t) {
        $establecimientos_flat[] = $t['nombre'];
        if (isset($prod_map[$t['id_productor']])) {
            $p_nombre = $prod_map[$t['id_productor']];
            $establecimientos_por_productor[$p_nombre][] = $t['nombre'];
        }
    }

    json_response([
        'ok' => true, 
        'productores' => $productores,
        'establecimientos' => $establecimientos_flat,
        'establecimientos_por_productor' => $establecimientos_por_productor
    ]);
}

// ============================================================
// SAVE — Guardar nuevo registro (INSERT)
// ============================================================
function action_save(string $uid, array $in): void {
    $db = getDB();

    // Validaciones mínimas: Ahora Productor es el nivel jerárquico superior obligatorio
    $productor = trim($in['productor'] ?? '');
    $establecimiento = trim($in['establecimiento'] ?? '');
    $fecha = trim($in['fecha'] ?? '');
    
    if (!$productor) json_response(['ok' => false, 'error' => 'El campo Productor es obligatorio.']);
    if (!$fecha || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha))
        json_response(['ok' => false, 'error' => 'Fecha inválida.']);

    $rp_ternero = trim($in['rp_ternero'] ?? '');
    $existing = null;
    if ($rp_ternero !== '') {
        $stmt_check = $db->prepare("SELECT * FROM registros WHERE user_id = ? AND UPPER(rp_ternero) = UPPER(?) LIMIT 1");
        $stmt_check->execute([$uid, $rp_ternero]);
        $existing = $stmt_check->fetch();
    }

    if ($existing) {
        $existing_id = $existing['id'];

        // Fusión de campos: si el dato entrante no está cargado (vacío/nulo), mantener el de la BD.
        $productor       = trim($in['productor'] ?? '') ?: $existing['productor'];
        $establecimiento = trim($in['establecimiento'] ?? '') ?: $existing['establecimiento'];
        $fecha           = trim($in['fecha'] ?? '') ?: $existing['fecha'];
        
        $ig_ternero = (isset($in['ig_ternero']) && is_numeric($in['ig_ternero'])) 
            ? (float)$in['ig_ternero'] 
            : ($existing['ig_ternero'] !== null ? (float)$existing['ig_ternero'] : null);
            
        $sexo = (isset($in['sexo']) && in_array($in['sexo'], ['Macho', 'Hembra'])) 
            ? $in['sexo'] 
            : ($existing['sexo'] ?: 'Macho');
            
        $ombligo = (isset($in['ombligo']) && in_array($in['ombligo'], ['Bueno', 'Regular', 'Malo'])) 
            ? $in['ombligo'] 
            : ($existing['ombligo'] ?: 'Bueno');
            
        $tipo_madre = (isset($in['tipo_madre']) && in_array($in['tipo_madre'], ['Vaca', 'Vaquillona'])) 
            ? $in['tipo_madre'] 
            : ($existing['tipo_madre'] ?: 'Vaca');
            
        $rp_madre = trim($in['rp_madre'] ?? '') ?: $existing['rp_madre'];
        
        $ig_calostro = (isset($in['ig_calostro']) && is_numeric($in['ig_calostro'])) 
            ? (float)$in['ig_calostro'] 
            : ($existing['ig_calostro'] !== null ? (float)$existing['ig_calostro'] : null);
            
        $estado = trim($in['estado'] ?? '') ?: $existing['estado'];
        
        $causa = trim($in['causa'] ?? '') ?: $existing['causa'];
        $causa_cat = trim($in['causa_categoria'] ?? '') ?: $existing['causa_categoria'];
        $causa_esp = trim($in['causa_especifica'] ?? '') ?: $existing['causa_especifica'];

        // Si el estado fusionado es 'Vivo', limpiar las causas
        if ($estado === 'Vivo') {
            $causa = null;
            $causa_cat = null;
            $causa_esp = null;
        }

        $stmt_update = $db->prepare(
            "UPDATE registros
             SET establecimiento = :establecimiento,
                 fecha = :fecha,
                 productor = :productor,
                 rp_ternero = :rp_ternero,
                 ig_ternero = :ig_ternero,
                 sexo = :sexo,
                 ombligo = :ombligo,
                 tipo_madre = :tipo_madre,
                 rp_madre = :rp_madre,
                 ig_calostro = :ig_calostro,
                 estado = :estado,
                 causa = :causa,
                 causa_categoria = :causa_cat,
                 causa_especifica = :causa_esp
             WHERE id = :id AND user_id = :uid"
        );

        $stmt_update->execute([
            ':id'              => $existing_id,
            ':uid'             => $uid,
            ':productor'       => $productor,
            ':establecimiento' => $establecimiento ?: null,
            ':fecha'           => $fecha,
            ':rp_ternero'      => $rp_ternero ?: null,
            ':ig_ternero'      => $ig_ternero,
            ':sexo'            => $sexo,
            ':ombligo'         => $ombligo,
            ':tipo_madre'      => $tipo_madre,
            ':rp_madre'        => $rp_madre ?: null,
            ':ig_calostro'     => $ig_calostro,
            ':estado'          => $estado,
            ':causa'           => $causa ?: null,
            ':causa_cat'       => $causa_cat ?: null,
            ':causa_esp'       => $causa_esp ?: null,
        ]);

        _manageRelations($db, $uid, $productor, $establecimiento);

        json_response(['ok' => true, 'id' => $existing_id]);
        return;
    }

    // ── Verificar límites del plan antes de insertar ──────────────────
    // Se obtiene el plan de la sesión (ya cargada en el global $session).
    // NULL = usuario legacy → sin límites (check_plan_limit lo ignora).
    $user_plan = $GLOBALS['_vf_session']['plan'] ?? 'legacy';

    // Chequear límite de registros totales
    check_plan_limit($uid, $user_plan, 'registros');

    // Chequear límite de productores (solo si el productor es nuevo)
    $prod_exists = $db->prepare("SELECT COUNT(*) FROM productores WHERE user_id = ? AND nombre = ?");
    $prod_exists->execute([$uid, $productor]);
    if ((int)$prod_exists->fetchColumn() === 0) {
        // Es un productor nuevo: verificar que no se supere el límite
        check_plan_limit($uid, $user_plan, 'productores');
    }
    // ── Fin de chequeo de límites ────────────────────────────────────


    $ig_ternero  = is_numeric($in['ig_ternero']  ?? null) ? (float)$in['ig_ternero']  : null;
    $ig_calostro = is_numeric($in['ig_calostro'] ?? null) ? (float)$in['ig_calostro'] : null;

    $stmt = $db->prepare(
        "INSERT INTO registros
            (user_id, establecimiento, fecha, productor, rp_ternero, ig_ternero,
             sexo, ombligo, tipo_madre, rp_madre, ig_calostro, estado, causa, 
             causa_categoria, causa_especifica)
         VALUES
            (:uid, :establecimiento, :fecha, :productor, :rp_ternero, :ig_ternero,
             :sexo, :ombligo, :tipo_madre, :rp_madre, :ig_calostro, :estado, :causa,
             :causa_cat, :causa_esp)"
    );

    $stmt->execute([
        ':uid'             => $uid,
        ':productor'       => $productor,
        ':establecimiento' => $establecimiento ?: null,
        ':fecha'       => $fecha,
        ':rp_ternero'  => trim($in['rp_ternero']  ?? '') ?: null,
        ':ig_ternero'  => $ig_ternero,
        ':sexo'        => in_array($in['sexo'] ?? '', ['Macho','Hembra']) ? $in['sexo'] : 'Macho',
        ':ombligo'     => in_array($in['ombligo'] ?? '', ['Bueno','Regular','Malo']) ? $in['ombligo'] : 'Bueno',
        ':tipo_madre'  => in_array($in['tipo_madre'] ?? '', ['Vaca','Vaquillona']) ? $in['tipo_madre'] : 'Vaca',
        ':rp_madre'    => trim($in['rp_madre']    ?? '') ?: null,
        ':ig_calostro' => $ig_calostro,
        ':estado'      => trim($in['estado']      ?? 'Vivo'),
        ':causa'       => trim($in['causa']        ?? '') ?: null,
        ':causa_cat'   => trim($in['causa_categoria'] ?? '') ?: null,
        ':causa_esp'   => trim($in['causa_especifica'] ?? '') ?: null,
    ]);

    $new_id = $db->lastInsertId();

    _manageRelations($db, $uid, $productor, $establecimiento);

    json_response(['ok' => true, 'id' => $new_id]);
}

function _manageRelations($db, string $uid, string $productor, string $establecimiento): void {
    try {
        $ins_prod = $db->prepare("INSERT IGNORE INTO productores (user_id, nombre) VALUES (?, ?)");
        $ins_prod->execute([$uid, $productor]);
        
        if ($establecimiento) {
            $sel_prod = $db->prepare("SELECT id FROM productores WHERE user_id = ? AND nombre = ?");
            $sel_prod->execute([$uid, $productor]);
            $id_prod = $sel_prod->fetchColumn();
            
            if ($id_prod) {
                $ins_establecimiento = $db->prepare("INSERT IGNORE INTO establecimientos (user_id, id_productor, nombre) VALUES (?, ?, ?)");
                $ins_establecimiento->execute([$uid, $id_prod, $establecimiento]);
            }
        }
    } catch (\Exception $e) {
        error_log("Error insertando en relaciones normalizadas: " . $e->getMessage());
    }
}

// ============================================================
// DELETE — Eliminar un registro del usuario
// ============================================================
function action_delete(string $uid, array $in): void {
    $id = (int)($in['id'] ?? 0);
    if (!$id) json_response(['ok' => false, 'error' => 'ID inválido.']);

    $db   = getDB();
    $stmt = $db->prepare("DELETE FROM registros WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $uid]);

    if ($stmt->rowCount() === 0) {
        json_response(['ok' => false, 'error' => 'Registro no encontrado o sin permisos.'], 403);
    }

    json_response(['ok' => true]);
}

// ============================================================
// BACKUP EXPORT — Exportar todos los datos del usuario en JSON
// No disponible para Plan Inicio.
// ============================================================
function action_backup_export(string $uid): void {
    // Backup export solo disponible en Plan Premium (o cuentas legacy sin límites).
    // Plan Inicio y Plan Pro no tienen acceso a esta función.
    $user_plan = $GLOBALS['_vf_session']['plan'] ?? null;
    if ($user_plan === 'inicio' || $user_plan === 'pro') {
        json_response([
            'ok'    => false,
            'error' => 'La exportación de copias de seguridad es exclusiva del Plan Premium. Actualizá tu plan para acceder a esta función.',
            'plan_required' => 'premium',
        ], 403);
    }
    $db = getDB();
    
    // Productores
    $stmt = $db->prepare("SELECT nombre FROM productores WHERE user_id = ? ORDER BY nombre ASC");
    $stmt->execute([$uid]);
    $productores = $stmt->fetchAll(PDO::FETCH_COLUMN);
    
    // Establecimientos
    $stmt = $db->prepare("SELECT e.nombre AS establecimiento, p.nombre AS productor 
                          FROM establecimientos e
                          JOIN productores p ON p.id = e.id_productor
                          WHERE e.user_id = ?");
    $stmt->execute([$uid]);
    $establecimientos = $stmt->fetchAll();
    
    // Registros
    $stmt = $db->prepare("SELECT * FROM registros WHERE user_id = ? ORDER BY fecha DESC");
    $stmt->execute([$uid]);
    $registros = $stmt->fetchAll();
    
    // Normalizar numéricos y quitar user_id para no exponerlo innecesariamente
    foreach ($registros as &$r) {
        $r['ig_ternero']  = $r['ig_ternero']  !== null ? (float)$r['ig_ternero']  : null;
        $r['ig_calostro'] = $r['ig_calostro'] !== null ? (float)$r['ig_calostro'] : null;
        unset($r['user_id']);
    }
    unset($r);
    
    json_response([
        'ok' => true,
        'version' => '1.0',
        'exported_at' => date('c'),
        'data' => [
            'productores' => $productores,
            'establecimientos' => $establecimientos,
            'registros' => $registros
        ]
    ]);
}

// ============================================================
// BACKUP IMPORT — Importar y fusionar respaldo del usuario
// ============================================================
function action_backup_import(string $uid, array $in): void {
    $db = getDB();
    
    $data = $in['data'] ?? null;
    if (!$data || !is_array($data)) {
        json_response(['ok' => false, 'error' => 'Datos de respaldo inválidos o vacíos.']);
    }
    
    $productores = $data['productores'] ?? [];
    $establecimientos = $data['establecimientos'] ?? [];
    $registros = $data['registros'] ?? [];
    
    $db->beginTransaction();
    try {
        // 1. Importar Productores
        foreach ($productores as $p_nombre) {
            $p_nombre = trim($p_nombre);
            if (!$p_nombre) continue;
            $stmt = $db->prepare("INSERT IGNORE INTO productores (user_id, nombre) VALUES (?, ?)");
            $stmt->execute([$uid, $p_nombre]);
        }
        
        // Mapeo actual de productores
        $stmt = $db->prepare("SELECT id, nombre FROM productores WHERE user_id = ?");
        $stmt->execute([$uid]);
        $prod_rows = $stmt->fetchAll();
        $prod_map = [];
        foreach ($prod_rows as $row) {
            $prod_map[$row['nombre']] = $row['id'];
        }
        
        // 2. Importar Establecimientos
        foreach ($establecimientos as $est) {
            $est_nombre = trim($est['establecimiento'] ?? $est['nombre'] ?? '');
            $p_nombre = trim($est['productor'] ?? '');
            if (!$est_nombre || !$p_nombre) continue;
            
            if (!isset($prod_map[$p_nombre])) {
                $stmt = $db->prepare("INSERT IGNORE INTO productores (user_id, nombre) VALUES (?, ?)");
                $stmt->execute([$uid, $p_nombre]);
                $new_p_id = $db->lastInsertId();
                if ($new_p_id) {
                    $prod_map[$p_nombre] = $new_p_id;
                } else {
                    $stmt_find = $db->prepare("SELECT id FROM productores WHERE user_id = ? AND nombre = ?");
                    $stmt_find->execute([$uid, $p_nombre]);
                    $prod_map[$p_nombre] = $stmt_find->fetchColumn();
                }
            }
            
            $p_id = $prod_map[$p_nombre] ?? null;
            if ($p_id) {
                $stmt = $db->prepare("INSERT IGNORE INTO establecimientos (user_id, id_productor, nombre) VALUES (?, ?, ?)");
                $stmt->execute([$uid, $p_id, $est_nombre]);
            }
        }
        
        // 3. Importar Registros
        $importados = 0;
        $actualizados = 0;
        
        foreach ($registros as $r) {
            $productor = trim($r['productor'] ?? '');
            $establecimiento = trim($r['establecimiento'] ?? '') ?: null;
            $fecha = trim($r['fecha'] ?? '');
            $rp_ternero = trim($r['rp_ternero'] ?? '') ?: null;
            
            if (!$productor || !$fecha) continue;
            
            $existing = null;
            if ($rp_ternero) {
                $stmt_check = $db->prepare("SELECT id FROM registros WHERE user_id = ? AND UPPER(rp_ternero) = UPPER(?) AND fecha = ? LIMIT 1");
                $stmt_check->execute([$uid, $rp_ternero, $fecha]);
                $existing = $stmt_check->fetchColumn();
            } else {
                $stmt_check = $db->prepare("SELECT id FROM registros WHERE user_id = ? AND productor = ? AND (establecimiento = ? OR (establecimiento IS NULL AND ? IS NULL)) AND fecha = ? LIMIT 1");
                $stmt_check->execute([$uid, $productor, $establecimiento, $establecimiento, $fecha]);
                $existing = $stmt_check->fetchColumn();
            }
            
            $ig_ternero  = is_numeric($r['ig_ternero'] ?? null) ? (float)$r['ig_ternero'] : null;
            $ig_calostro = is_numeric($r['ig_calostro'] ?? null) ? (float)$r['ig_calostro'] : null;
            $sexo        = in_array($r['sexo'] ?? '', ['Macho', 'Hembra']) ? $r['sexo'] : 'Macho';
            $ombligo     = in_array($r['ombligo'] ?? '', ['Bueno', 'Regular', 'Malo']) ? $r['ombligo'] : 'Bueno';
            $tipo_madre  = in_array($r['tipo_madre'] ?? '', ['Vaca', 'Vaquillona']) ? $r['tipo_madre'] : 'Vaca';
            $rp_madre    = trim($r['rp_madre'] ?? '') ?: null;
            $estado      = trim($r['estado'] ?? 'Vivo');
            $causa       = trim($r['causa'] ?? '') ?: null;
            $causa_cat   = trim($r['causa_categoria'] ?? '') ?: null;
            $causa_esp   = trim($r['causa_especifica'] ?? '') ?: null;
            
            if ($estado === 'Vivo') {
                $causa = null;
                $causa_cat = null;
                $causa_esp = null;
            }
            
            if ($existing) {
                $stmt_upd = $db->prepare(
                    "UPDATE registros
                     SET establecimiento = :establecimiento,
                         productor = :productor,
                         ig_ternero = :ig_ternero,
                         sexo = :sexo,
                         ombligo = :ombligo,
                         tipo_madre = :tipo_madre,
                         rp_madre = :rp_madre,
                         ig_calostro = :ig_calostro,
                         estado = :estado,
                         causa = :causa,
                         causa_categoria = :causa_cat,
                         causa_especifica = :causa_esp
                     WHERE id = :id AND user_id = :uid"
                );
                $stmt_upd->execute([
                    ':id' => $existing,
                    ':uid' => $uid,
                    ':productor' => $productor,
                    ':establecimiento' => $establecimiento,
                    ':ig_ternero' => $ig_ternero,
                    ':sexo' => $sexo,
                    ':ombligo' => $ombligo,
                    ':tipo_madre' => $tipo_madre,
                    ':rp_madre' => $rp_madre,
                    ':ig_calostro' => $ig_calostro,
                    ':estado' => $estado,
                    ':causa' => $causa,
                    ':causa_cat' => $causa_cat,
                    ':causa_esp' => $causa_esp
                ]);
                $actualizados++;
            } else {
                $stmt_ins = $db->prepare(
                    "INSERT INTO registros
                        (user_id, establecimiento, fecha, productor, rp_ternero, ig_ternero,
                         sexo, ombligo, tipo_madre, rp_madre, ig_calostro, estado, causa, 
                         causa_categoria, causa_especifica)
                    VALUES
                        (:uid, :establecimiento, :fecha, :productor, :rp_ternero, :ig_ternero,
                         :sexo, :ombligo, :tipo_madre, :rp_madre, :ig_calostro, :estado, :causa,
                         :causa_cat, :causa_esp)"
                );
                $stmt_ins->execute([
                    ':uid' => $uid,
                    ':establecimiento' => $establecimiento,
                    ':fecha' => $fecha,
                    ':productor' => $productor,
                    ':rp_ternero' => $rp_ternero,
                    ':ig_ternero' => $ig_ternero,
                    ':sexo' => $sexo,
                    ':ombligo' => $ombligo,
                    ':tipo_madre' => $tipo_madre,
                    ':rp_madre' => $rp_madre,
                    ':ig_calostro' => $ig_calostro,
                    ':estado' => $estado,
                    ':causa' => $causa,
                    ':causa_cat' => $causa_cat,
                    ':causa_esp' => $causa_esp
                ]);
                $importados++;
            }
        }
        
        $db->commit();
        
        json_response([
            'ok' => true,
            'importados' => $importados,
            'actualizados' => $actualizados,
            'message' => "Respaldo restaurado con éxito. Se importaron {$importados} registros nuevos y se actualizaron {$actualizados} existentes."
        ]);
    } catch (\Exception $e) {
        $db->rollBack();
        json_response(['ok' => false, 'error' => 'Error al restaurar los datos: ' . $e->getMessage()]);
    }
}
