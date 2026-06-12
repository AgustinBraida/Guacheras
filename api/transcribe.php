<?php
// ================================================================
// VETFIELD PRO — api/transcribe.php
// Proxy seguro: audio del cliente → OpenAI Whisper → texto
// ================================================================
// SEGURIDAD:
//   - La API Key nunca sale del servidor (está en db_config.php)
//   - Solo acepta POST multipart con un campo 'audio'
//   - Valida sesión activa antes de procesar
// ================================================================

require_once __DIR__ . '/db_config.php';

// ── Solo POST ─────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'error' => 'Método no permitido.'], 405);
}

// ── Validar sesión (Bearer token) ─────────────────────────────
$user = validate_session();
if (!$user) {
    json_response(['ok' => false, 'error' => 'No autenticado.'], 401);
}

// Rate limiting: 30 transcripciones por hora por usuario
$ip = rl_get_client_ip();
$rl_key = $user['id'] . '_transcribe';
if (rl_get_fails($ip, $rl_key, RL_TRANSCRIBE_WIN) >= RL_TRANSCRIBE_MAX)
    json_response(['ok' => false, 'error' => 'Límite de transcripciones alcanzado. Esperá 1 hora.'], 429);
rl_increment($ip, $rl_key, RL_TRANSCRIBE_WIN);


// ── Verificar que llegó el archivo de audio ────────────────────
if (empty($_FILES['audio']) || $_FILES['audio']['error'] !== UPLOAD_ERR_OK) {
    $err = $_FILES['audio']['error'] ?? 'sin archivo';
    json_response(['ok' => false, 'error' => "Error de carga de audio: {$err}"], 400);
}

$tmpPath  = $_FILES['audio']['tmp_name'];
$origName = $_FILES['audio']['name'] ?? 'recording.webm';
$mimeType = $_FILES['audio']['type'] ?? 'audio/webm';

// Validar tipo MIME permitido por Whisper
$allowedMimes = [
    'audio/webm', 'audio/webm;codecs=opus',
    'audio/mp4', 'audio/mpeg', 'audio/mpga',
    'audio/mp3', 'audio/wav', 'audio/x-wav',
    'audio/ogg', 'audio/flac', 'audio/x-m4a',
];
$mimeBase = strtolower(explode(';', $mimeType)[0]);
if (!in_array($mimeBase, $allowedMimes, true)) {
    json_response(['ok' => false, 'error' => "Tipo de audio no soportado: {$mimeType}"], 415);
}

// ── Prompt de contexto veterinario (guía a Whisper) ───────────
$WHISPER_PROMPT = 'Este es un dictado técnico de un veterinario en un tambo. '
    . 'Los términos clave incluyen: Caravana (RP), Nivel de Inmunoglobulina (IG), '
    . 'Calostro, Vaca, Vaquillona, Ombligo Bueno/Regular/Malo. '
    . 'Formatea siempre los números como dígitos (ej: 2.5, 10, 456). '
    . 'Incluye términos de salud animal como Colibacilosis, Neumonía, '
    . 'Estrés calórico y Onfalitis.';

// ── Construir petición multipart hacia OpenAI ─────────────────
$boundary = '----VetFieldBoundary' . bin2hex(random_bytes(8));
$audioData = file_get_contents($tmpPath);

$body  = "--{$boundary}\r\n";
$body .= "Content-Disposition: form-data; name=\"file\"; filename=\"{$origName}\"\r\n";
$body .= "Content-Type: {$mimeType}\r\n\r\n";
$body .= $audioData . "\r\n";
$body .= "--{$boundary}\r\n";
$body .= "Content-Disposition: form-data; name=\"model\"\r\n\r\n";
$body .= "whisper-1\r\n";
$body .= "--{$boundary}\r\n";
$body .= "Content-Disposition: form-data; name=\"language\"\r\n\r\n";
$body .= "es\r\n";
$body .= "--{$boundary}\r\n";
$body .= "Content-Disposition: form-data; name=\"prompt\"\r\n\r\n";
$body .= $WHISPER_PROMPT . "\r\n";
$body .= "--{$boundary}--\r\n";

// ── Enviar a OpenAI con cURL ───────────────────────────────────
$ch = curl_init('https://api.openai.com/v1/audio/transcriptions');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $body,
    CURLOPT_HTTPHEADER     => [
        'Authorization: Bearer ' . OPENAI_API_KEY,
        'Content-Type: multipart/form-data; boundary=' . $boundary,
        'Content-Length: ' . strlen($body),
    ],
    CURLOPT_TIMEOUT        => 60,
    CURLOPT_SSL_VERIFYPEER => true,
]);

$rawResponse = curl_exec($ch);
$httpCode    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError   = curl_error($ch);

// ── Manejar errores de red ────────────────────────────────────
if ($curlError) {
    error_log("[transcribe.php] cURL error: {$curlError}");
    json_response(['ok' => false, 'error' => 'Error de red al contactar OpenAI.'], 502);
}

// ── Parsear respuesta de OpenAI ────────────────────────────────
$openaiJson = json_decode($rawResponse, true);

if ($httpCode !== 200 || empty($openaiJson['text'])) {
    $openaiErr = $openaiJson['error']['message'] ?? $rawResponse;
    error_log("[transcribe.php] OpenAI HTTP {$httpCode}: {$openaiErr}");
    json_response([
        'ok'    => false,
        'error' => "Error de transcripción (HTTP {$httpCode}): " . substr($openaiErr, 0, 200),
    ], 502);
}

// ── Éxito: devolver texto transcrito ──────────────────────────
json_response([
    'ok'   => true,
    'text' => trim($openaiJson['text']),
]);
