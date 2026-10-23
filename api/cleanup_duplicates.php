<?php
// ============================================================
// VETFIELD PRO — Limpieza de recorridas duplicadas
// ⚠️  Ejecutar UNA SOLA VEZ y luego ELIMINAR este archivo
// Acceder via: https://www.vetfield.pro/api/cleanup_duplicates.php?key=limpiar2024
// ============================================================

// Clave de seguridad para que nadie más lo pueda ejecutar
$SECRET_KEY = 'limpiar2024';
if (($_GET['key'] ?? '') !== $SECRET_KEY) {
    http_response_code(403);
    die(json_encode(['ok' => false, 'error' => 'Acceso denegado. Agregá ?key=limpiar2024 a la URL']));
}

require_once __DIR__ . '/db_config.php';

header('Content-Type: application/json; charset=utf-8');

try {
    $db = getDB();

    // 1. Obtener todos los grupos duplicados: (user_id, establecimiento, fecha)
    $stmt = $db->query("
        SELECT user_id, establecimiento, fecha, COUNT(*) as total, MAX(id) as ultimo_id
        FROM recorridas
        GROUP BY user_id, establecimiento, fecha
        HAVING COUNT(*) > 1
        ORDER BY user_id, establecimiento, fecha
    ");
    $grupos = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $resultado = [];
    $totalEliminados = 0;

    foreach ($grupos as $g) {
        $uid   = $g['user_id'];
        $est   = $g['establecimiento'];
        $fecha = $g['fecha'];

        // 2. Traer TODOS los registros de este grupo, ordenados del más antiguo al más reciente
        $stmtRecs = $db->prepare("
            SELECT id, hallazgos, productor
            FROM recorridas
            WHERE user_id = ? AND establecimiento = ? AND fecha = ?
            ORDER BY id ASC
        ");
        $stmtRecs->execute([$uid, $est, $fecha]);
        $recs = $stmtRecs->fetchAll(PDO::FETCH_ASSOC);

        // 3. Mergear TODOS los hallazgos, el más reciente gana en caso de ID duplicado
        $hallazgosMergeados = [];
        foreach ($recs as $rec) {
            $items = json_decode($rec['hallazgos'] ?? '[]', true) ?: [];
            foreach ($items as $item) {
                $itemId = $item['id'] ?? null;
                if ($itemId) {
                    // El más reciente (mayor ID de recorrida) sobrescribe al anterior
                    $hallazgosMergeados[$itemId] = $item;
                } else {
                    $hallazgosMergeados[] = $item;
                }
            }
        }
        $hallazgosFinal = array_values($hallazgosMergeados);

        // El registro "ganador" es el de mayor ID (el más reciente)
        $idGanador = (int)$g['ultimo_id'];
        $productor = $recs[count($recs) - 1]['productor'];

        // 4. Actualizar el ganador con los hallazgos mergeados
        $stmtUpdate = $db->prepare("
            UPDATE recorridas 
            SET hallazgos = ?, productor = ?
            WHERE id = ?
        ");
        $stmtUpdate->execute([
            json_encode($hallazgosFinal, JSON_UNESCAPED_UNICODE),
            $productor,
            $idGanador
        ]);

        // 5. Eliminar todos los duplicados (todos menos el ganador)
        $stmtDelete = $db->prepare("
            DELETE FROM recorridas
            WHERE user_id = ? AND establecimiento = ? AND fecha = ? AND id != ?
        ");
        $stmtDelete->execute([$uid, $est, $fecha, $idGanador]);
        $eliminados = $stmtDelete->rowCount();
        $totalEliminados += $eliminados;

        $resultado[] = [
            'usuario'      => $uid,
            'establecimiento' => $est,
            'fecha'        => $fecha,
            'duplicados_encontrados' => (int)$g['total'],
            'duplicados_eliminados'  => $eliminados,
            'id_conservado'          => $idGanador,
            'hallazgos_mergeados'    => count($hallazgosFinal),
        ];
    }

    echo json_encode([
        'ok'               => true,
        'grupos_duplicados' => count($grupos),
        'total_eliminados'  => $totalEliminados,
        'detalle'          => $resultado,
        'mensaje'          => $totalEliminados > 0
            ? "✅ Limpieza completa. Se eliminaron {$totalEliminados} registros duplicados."
            : "✅ No se encontraron duplicados. La base de datos ya está limpia.",
        'aviso'            => '⚠️  ELIMINÁ este archivo del servidor ahora que ya lo ejecutaste.'
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
