<?php
// ============================================================
// VETFIELD PRO — api/test_mail.php
// Script de diagnóstico para depurar la conexión SMTP.
// ============================================================

require_once __DIR__ . '/db_config.php';

// Mostrar errores en pantalla
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

echo "<html><head><title>Vetfield Pro - Diagnóstico SMTP</title>";
echo "<style>body{font-family:sans-serif;background:#fafafa;padding:30px;color:#333;}
.box{background:#fff;padding:20px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);max-width:600px;margin:auto;}
pre{background:#f4f4f4;padding:15px;border-radius:4px;overflow-x:auto;}
.success{color:green;font-weight:bold;}
.error{color:red;font-weight:bold;}
</style></head><body>";

echo "<div class='box'>";
echo "<h2>Diagnóstico SMTP - VETFIELD PRO</h2>";
echo "<strong>Configuración detectada:</strong><br><br>";
echo "• Método: " . htmlspecialchars(MAIL_METHOD) . "<br>";
echo "• Host SMTP: " . htmlspecialchars(MAIL_SMTP_HOST) . "<br>";
echo "• Puerto SMTP: " . htmlspecialchars(MAIL_SMTP_PORT) . "<br>";
echo "• Usuario SMTP: " . htmlspecialchars(MAIL_SMTP_USER) . "<br>";
echo "• Protocolo SSL/TLS: " . htmlspecialchars(MAIL_SMTP_SECURE) . "<br>";
echo "• Dirección Remitente: " . htmlspecialchars(MAIL_FROM) . "<br>";
echo "• Contraseña configurada: " . (strlen(MAIL_SMTP_PASS) > 0 ? "SÍ (longitud: " . strlen(MAIL_SMTP_PASS) . ")" : "NO") . "<br><br>";

$to = "agustinbraida29@gmail.com";
$subject = "Prueba de Diagnóstico SMTP - VETFIELD PRO";
$body = "Esta es una prueba de envío SMTP para verificar la conexión directa desde el servidor.";

echo "<hr>";
echo "<h3>Iniciando prueba de envío a: $to</h3>";

$phpmailer_path = __DIR__ . '/vendor/autoload.php';
if (file_exists($phpmailer_path)) {
    echo "<p><strong>Estado:</strong> PHPMailer (Composer) detectado. Usando librería oficial...</p>";
    require_once $phpmailer_path;
    $mailerClass = '\\PHPMailer\\PHPMailer\\PHPMailer';
    $mail = new $mailerClass(true);
    try {
        $mail->isSMTP();
        $mail->SMTPDebug = 2; // Debug detallado
        $mail->Debugoutput = function($str, $level) {
            echo "<pre>DEBUG: " . htmlspecialchars($str) . "</pre>";
        };
        $mail->Host       = MAIL_SMTP_HOST;
        $mail->SMTPAuth   = true;
        $mail->Username   = MAIL_SMTP_USER;
        $mail->Password   = MAIL_SMTP_PASS;
        $mail->SMTPSecure = MAIL_SMTP_SECURE;
        $mail->Port       = MAIL_SMTP_PORT;
        $mail->CharSet    = 'utf-8';
        $mail->setFrom(MAIL_FROM, MAIL_FROM_NAME);
        $mail->addAddress($to);
        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body    = $body;
        $mail->send();
        echo "<p class='success'>¡Éxito! El correo se envió correctamente usando PHPMailer.</p>";
    } catch (\Exception $e) {
        echo "<p class='error'>Error de PHPMailer: " . htmlspecialchars($e->getMessage()) . "</p>";
    }
} else {
    echo "<p><strong>Estado:</strong> PHPMailer no detectado. Usando Socket nativo (send_email_raw_smtp)...</p>";
    try {
        $prefix = (MAIL_SMTP_SECURE === 'ssl') ? 'ssl://' : '';
        echo "Conectando a: <code>" . $prefix . MAIL_SMTP_HOST . ":" . MAIL_SMTP_PORT . "</code>...<br>";
        
        $socket = @fsockopen($prefix . MAIL_SMTP_HOST, MAIL_SMTP_PORT, $errno, $errstr, 15);
        if (!$socket) {
            throw new Exception("Error de conexión por Socket: [$errno] $errstr");
        }
        
        echo "<span class='success'>Conexión establecida.</span> Leyendo respuesta inicial:<br>";
        $resp = fgets($socket, 512);
        echo "<code>&lt; " . htmlspecialchars(trim($resp)) . "</code><br>";
        
        fwrite($socket, "EHLO vetfieldpro\r\n");
        $resp = fgets($socket, 512);
        echo "<code>&gt; EHLO vetfieldpro</code><br>";
        echo "<code>&lt; " . htmlspecialchars(trim($resp)) . "</code><br>";
        
        // Consumir el resto de líneas del EHLO
        stream_set_timeout($socket, 1);
        while ($line = fgets($socket, 512)) {
            echo "<code>&lt; " . htmlspecialchars(trim($line)) . "</code><br>";
        }
        stream_set_timeout($socket, 15);
        
        if (MAIL_SMTP_SECURE === 'tls') {
            fwrite($socket, "STARTTLS\r\n");
            $resp = fgets($socket, 512);
            echo "<code>&gt; STARTTLS</code><br>";
            echo "<code>&lt; " . htmlspecialchars(trim($resp)) . "</code><br>";
            stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
            
            fwrite($socket, "EHLO vetfieldpro\r\n");
            $resp = fgets($socket, 512);
            echo "<code>&gt; EHLO (Post-TLS)</code><br>";
            echo "<code>&lt; " . htmlspecialchars(trim($resp)) . "</code><br>";
        }
        
        fwrite($socket, "AUTH LOGIN\r\n");
        $resp = fgets($socket, 512);
        echo "<code>&gt; AUTH LOGIN</code><br>";
        echo "<code>&lt; " . htmlspecialchars(trim($resp)) . "</code><br>";
        
        fwrite($socket, base64_encode(MAIL_SMTP_USER) . "\r\n");
        $resp = fgets($socket, 512);
        echo "<code>&gt; Enviando usuario en Base64</code><br>";
        echo "<code>&lt; " . htmlspecialchars(trim($resp)) . "</code><br>";
        
        fwrite($socket, base64_encode(MAIL_SMTP_PASS) . "\r\n");
        $resp = fgets($socket, 512);
        echo "<code>&gt; Enviando contraseña en Base64</code><br>";
        echo "<code>&lt; " . htmlspecialchars(trim($resp)) . "</code><br>";
        
        if (strpos($resp, '235') === false && strpos($resp, '334') === false) {
            throw new Exception("Error de autenticación SMTP: " . trim($resp));
        }
        
        fwrite($socket, "MAIL FROM:<" . MAIL_FROM . ">\r\n");
        $resp = fgets($socket, 512);
        echo "<code>&gt; MAIL FROM</code><br>";
        echo "<code>&lt; " . htmlspecialchars(trim($resp)) . "</code><br>";
        
        fwrite($socket, "RCPT TO:<{$to}>\r\n");
        $resp = fgets($socket, 512);
        echo "<code>&gt; RCPT TO</code><br>";
        echo "<code>&lt; " . htmlspecialchars(trim($resp)) . "</code><br>";
        
        fwrite($socket, "DATA\r\n");
        $resp = fgets($socket, 512);
        echo "<code>&gt; DATA</code><br>";
        echo "<code>&lt; " . htmlspecialchars(trim($resp)) . "</code><br>";
        
        $msg  = "From: " . MAIL_FROM_NAME . " <" . MAIL_FROM . ">\r\n";
        $msg .= "To: {$to}\r\n";
        $msg .= "Subject: =?utf-8?B?" . base64_encode($subject) . "?=\r\n";
        $msg .= "MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n";
        $msg .= $body . "\r\n.\r\n";
        
        fwrite($socket, $msg);
        $resp = fgets($socket, 512);
        echo "<code>&gt; Enviando contenido y terminador</code><br>";
        echo "<code>&lt; " . htmlspecialchars(trim($resp)) . "</code><br>";
        
        fwrite($socket, "QUIT\r\n");
        fclose($socket);
        echo "<p class='success'>¡Éxito! El correo se envió correctamente usando Socket nativo.</p>";
    } catch (\Exception $e) {
        echo "<p class='error'>Error de Socket: " . htmlspecialchars($e->getMessage()) . "</p>";
    }
}

echo "</div></body></html>";
