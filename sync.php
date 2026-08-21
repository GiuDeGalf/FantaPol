<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$extraAllowedOrigins = [
    // 'https://regia.example.com',
];
$localOrigin = preg_match('#^http://(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):[0-9]{2,5}$#i', $origin) === 1;
$originAllowed = $localOrigin || in_array($origin, $extraAllowedOrigins, true);
if ($originAllowed) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    if (!$originAllowed) {
        http_response_code(403);
        exit;
    }
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 86400');
    http_response_code(204);
    exit;
}

function respond(int $status, array $body): never {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function valid_room(mixed $room): string {
    if (!is_string($room) || !preg_match('/^[A-Z0-9]{6,24}$/i', $room)) {
        respond(400, ['error' => 'Codice asta non valido']);
    }
    return strtoupper($room);
}

$dataDir = __DIR__ . DIRECTORY_SEPARATOR . 'sync-data';
if (!is_dir($dataDir) && !mkdir($dataDir, 0750, true) && !is_dir($dataDir)) {
    respond(500, ['error' => 'Cartella dati non scrivibile']);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $room = valid_room($_GET['room'] ?? null);
    $file = $dataDir . DIRECTORY_SEPARATOR . hash('sha256', $room) . '.json';
    if (!is_file($file)) respond(404, ['error' => 'Asta non ancora disponibile']);
    $stored = json_decode((string) file_get_contents($file), true);
    if (!is_array($stored) || !isset($stored['state'])) respond(500, ['error' => 'Dati asta non validi']);
    respond(200, ['state' => $stored['state']]);
}

if ($method !== 'POST') respond(405, ['error' => 'Metodo non consentito']);

$length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($length > 1_500_000) respond(413, ['error' => 'Dati troppo grandi']);
$input = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($input)) respond(400, ['error' => 'JSON non valido']);

$room = valid_room($input['room'] ?? null);
$token = $input['token'] ?? null;
$state = $input['state'] ?? null;
if (!is_string($token) || strlen($token) < 32 || !is_array($state)) respond(400, ['error' => 'Dati mancanti']);

$file = $dataDir . DIRECTORY_SEPARATOR . hash('sha256', $room) . '.json';
$tokenHash = hash('sha256', $token);
if (is_file($file)) {
    $existing = json_decode((string) file_get_contents($file), true);
    if (!is_array($existing) || !isset($existing['tokenHash']) || !hash_equals((string) $existing['tokenHash'], $tokenHash)) {
        respond(403, ['error' => 'Token asta non valido']);
    }
}

$payload = json_encode([
    'tokenHash' => $tokenHash,
    'state' => $state,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($payload === false) respond(500, ['error' => 'Impossibile serializzare i dati']);

$temporary = $file . '.' . bin2hex(random_bytes(5)) . '.tmp';
if (file_put_contents($temporary, $payload, LOCK_EX) === false || !rename($temporary, $file)) {
    @unlink($temporary);
    respond(500, ['error' => 'Impossibile salvare i dati']);
}

respond(200, ['ok' => true, 'updatedAt' => $state['updatedAt'] ?? null]);
