<?php
declare(strict_types=1);

$remote = $_SERVER['REMOTE_ADDR'] ?? '';
if (!in_array($remote, ['127.0.0.1', '::1'], true)) {
    http_response_code(403);
    exit;
}

$state = isset($_GET['closed']) ? 'closed' : (string) time();
file_put_contents(__DIR__ . DIRECTORY_SEPARATOR . '.fantapol-heartbeat', $state, LOCK_EX);
http_response_code(204);
