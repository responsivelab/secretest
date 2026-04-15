<?php
// secrecha.php — da caricare nella root di andrealeti.it
// Riceve la notifica di login e manda l'email

// Blocca tutto tranne POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

$to   = isset($_POST['to'])   ? trim($_POST['to'])   : '';
$user = isset($_POST['user']) ? trim($_POST['user']) : '';
$time = isset($_POST['time']) ? trim($_POST['time']) : '';
$date = isset($_POST['date']) ? trim($_POST['date']) : '';

// Validazione minima
if (empty($to) || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    exit;
}

// ─── Contenuto email ──────────────────────────────────────────────────────────
$subject = "Il tuo ordine Zolando è in elaborazione";

$body = "
<!DOCTYPE html>
<html lang='it'>
<head><meta charset='UTF-8'></head>
<body style='margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;'>
  <table width='100%' cellpadding='0' cellspacing='0' style='background:#f4f4f4;padding:30px 0;'>
    <tr><td align='center'>
      <table width='520' cellpadding='0' cellspacing='0' style='background:#ffffff;border-radius:6px;overflow:hidden;'>

        <!-- Header -->
        <tr>
          <td style='background:#ff6600;padding:24px 32px;text-align:center;'>
            <span style='font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:1px;'>ZOLANDO</span>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style='padding:32px;color:#333333;'>
            <p style='font-size:16px;font-weight:bold;margin:0 0 16px;'>
              Ciao, il tuo ordine è stato ricevuto!
            </p>
            <p style='font-size:14px;line-height:1.6;margin:0 0 20px;color:#555;'>
              Abbiamo ricevuto il tuo ordine e lo stiamo elaborando.<br>
              Riceverai una conferma di spedizione a breve.
            </p>

            <!-- Box info ordine -->
            <table width='100%' cellpadding='0' cellspacing='0'
              style='background:#f9f9f9;border:1px solid #eeeeee;border-radius:4px;margin-bottom:24px;'>
              <tr>
                <td style='padding:16px 20px;'>
                  <p style='margin:0 0 8px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:0.5px;'>
                    Dettagli accesso account
                  </p>
                  <p style='margin:0 0 4px;font-size:14px;color:#333;'>
                    <strong>Utente:</strong> {$user}
                  </p>
                  <p style='margin:0 0 4px;font-size:14px;color:#333;'>
                    <strong>Data:</strong> {$date}
                  </p>
                  <p style='margin:0;font-size:14px;color:#333;'>
                    <strong>Ora:</strong> {$time}
                  </p>
                </td>
              </tr>
            </table>

            <p style='font-size:13px;color:#888;line-height:1.6;margin:0;'>
              Se non hai effettuato tu questo accesso, contatta immediatamente
              il nostro servizio clienti.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style='background:#f9f9f9;padding:20px 32px;border-top:1px solid #eeeeee;text-align:center;'>
            <p style='margin:0;font-size:11px;color:#aaa;'>
              © Zolando S.r.l. — Via dello Shopping 12, Milano
              &nbsp;·&nbsp; Non rispondere a questa email
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
";

// ─── Headers email ────────────────────────────────────────────────────────────
$headers  = "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: text/html; charset=UTF-8\r\n";
$headers .= "From: Zolando <noreply@andrealeti.it>\r\n";
$headers .= "X-Mailer: PHP/" . phpversion();

$sent = mail($to, $subject, $body, $headers);

if ($sent) {
    http_response_code(200);
    echo 'ok';
} else {
    http_response_code(500);
    echo 'error';
}
?>
