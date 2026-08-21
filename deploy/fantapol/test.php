<?php
declare(strict_types=1);
header('Content-Type: text/plain; charset=utf-8');
$directory = __DIR__ . DIRECTORY_SEPARATOR . 'sync-data';
if (!is_dir($directory) && !mkdir($directory, 0750, true)) {
    http_response_code(500);
    exit("ERRORE: impossibile creare sync-data\n");
}
$probe = $directory . DIRECTORY_SEPARATOR . '.write-test';
if (file_put_contents($probe, 'ok', LOCK_EX) === false) {
    http_response_code(500);
    exit("ERRORE: sync-data non è scrivibile\n");
}
unlink($probe);
echo "OK — FantaPol può sincronizzare i dati. Elimina ora test.php.\n";
