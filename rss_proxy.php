<?php
/**
 * rss_proxy.php – Proxy RSS local pour RadioNews
 * Contourne les restrictions CORS et filtre User-Agent des flux.
 */

header('Content-Type: application/xml; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

$url = filter_var($_GET['url'] ?? '', FILTER_VALIDATE_URL);

if (!$url) {
    http_response_code(400);
    exit;
}

$scheme = parse_url($url, PHP_URL_SCHEME);
if (!in_array($scheme, ['http', 'https'], true)) {
    http_response_code(400);
    exit;
}

if (function_exists('curl_version')) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    // Masque le proxy derrière un User-Agent de navigateur classique
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    curl_setopt($ch, CURLOPT_ENCODING, ''); // Active auto-décodage gzip
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    
    $content = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($content === false || $httpCode >= 400) {
        http_response_code(502);
        exit;
    }
} else {
    // Fallback si CURL n'est pas actif
    $opts = [
        "http" => [
            "method" => "GET",
            "header" => "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\n",
            "follow_location" => 1,
            "max_redirects" => 5,
            "timeout" => 10
        ]
    ];
    $context = stream_context_create($opts);
    $content = @file_get_contents($url, false, $context);
    
    if ($content === false) {
        http_response_code(502);
        exit;
    }
}

echo $content;
