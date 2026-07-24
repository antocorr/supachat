<?php

require __DIR__ . '/RpcAble.php';

class DemoUserSession
{
    public array $permissions = [
        'join' => ['user', 'admin'],
        'getGames' => ['user', 'admin'],
        'ping' => ['user', 'admin'],
        'queueInboxNote' => ['user', 'admin'],
        'clearPending' => ['user', 'admin'],
        'mood' => ['user', 'admin'],
    ];

    public RpcAbleCollector $client;
    public RpcAbleReceiver $receiver;
    public string $mood = 'calm';

    private ?RpcAbleHttpAdapter $httpAdapter = null;
    private ?RpcAblePendingStoreInterface $pendingStore = null;
    private string $sessionKey = 'anonymous';
    private string $storageDriver = 'session';

    public function __construct(private array $userData)
    {
        $this->receiver = new RpcAbleReceiver(['target' => $this]);
    }

    public function setClient(RpcAbleCollector $client): void
    {
        $this->client = $client;
    }

    public function configurePending(RpcAblePendingStoreInterface $store, string $sessionKey, string $storageDriver): void
    {
        $this->pendingStore = $store;
        $this->sessionKey = $sessionKey;
        $this->storageDriver = $storageDriver;
    }

    public function setHttpAdapter(RpcAbleHttpAdapter $httpAdapter): void
    {
        $this->httpAdapter = $httpAdapter;
    }

    public function join(array $payload = []): array
    {
        $name = trim((string) ($payload['name'] ?? $this->userData['name'] ?? 'guest'));
        if ($name === '') {
            $name = 'guest';
        }

        $user = [
            'id' => $this->userData['userId'],
            'name' => $name,
            'role' => $this->userData['role'],
            'sessionId' => $this->sessionKey,
            'mood' => $this->mood,
        ];

        $this->client->joined([
            'user' => $user,
            'storage' => $this->storageDriver,
        ]);

        return [
            'welcomedAs' => $name,
            'sessionId' => $this->sessionKey,
            'storage' => $this->storageDriver,
        ];
    }

    public function getGames(): int
    {
        $games = [
            ['id' => 1, 'name' => 'Chess', 'players' => 2, 'genre' => 'strategy'],
            ['id' => 2, 'name' => 'Mario Kart', 'players' => 8, 'genre' => 'party'],
            ['id' => 3, 'name' => 'Hades', 'players' => 1, 'genre' => 'roguelike'],
            ['id' => 4, 'name' => 'Street Fighter', 'players' => 2, 'genre' => 'fighting'],
        ];

        $this->client->gamesReceived($games);
        return count($games);
    }

    public function ping(): array
    {
        return [
            'now' => gmdate('c'),
            'transport' => 'http-php',
            'storage' => $this->storageDriver,
            'sessionKey' => $this->sessionKey,
            'mood' => $this->mood,
        ];
    }

    public function queueInboxNote(?string $message = null): array
    {
        if (!$this->httpAdapter) {
            throw new RuntimeException('HTTP adapter not configured');
        }

        $text = trim((string) ($message ?? 'Remember to ping the server later.'));
        if ($text === '') {
            $text = 'Remember to ping the server later.';
        }

        $pendingCount = 1;
        if ($this->pendingStore) {
            $pendingCount = count($this->pendingStore->restore($this->sessionKey)) + 1;
        }

        $this->httpAdapter->queuePending([[
            'path' => ['readMessage'],
            'args' => [[
                'title' => 'Stored for later',
                'content' => $text . ' (store=' . $this->storageDriver . ', key=' . $this->sessionKey . ')',
            ]],
        ]]);

        return [
            'queued' => true,
            'pendingCount' => $pendingCount,
            'storage' => $this->storageDriver,
        ];
    }

    public function clearPending(): array
    {
        if (!$this->httpAdapter) {
            throw new RuntimeException('HTTP adapter not configured');
        }

        $clearedCount = 0;
        if ($this->pendingStore) {
            $clearedCount = count($this->pendingStore->restore($this->sessionKey));
        }

        $this->httpAdapter->clearPending();

        return [
            'cleared' => true,
            'clearedCount' => $clearedCount,
        ];
    }
}

function headerValue(string $name, string $fallback = ''): string
{
    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return trim((string) ($_SERVER[$serverKey] ?? $fallback));
}

function chooseStore(string $storageDriver): RpcAblePendingStoreInterface
{
    return match ($storageDriver) {
        'file' => new RpcAbleJsonFileStore(__DIR__ . '/storage/pending.json'),
        'directory' => new RpcAbleJsonDirectoryStore(__DIR__ . '/storage/pending'),
        default => new RpcAbleSessionStore(),
    };
}

$storageDriver = strtolower(headerValue('x-storage-driver', 'session'));
if (!in_array($storageDriver, ['session', 'file', 'directory'], true)) {
    $storageDriver = 'session';
}

$sessionKey = headerValue('x-session-id');
if ($sessionKey === '') {
    $sessionKey = 'php-demo';
}

$userData = [
    'userId' => '42',
    'role' => headerValue('x-role', 'user'),
    'name' => headerValue('x-user-name', 'php-pilot'),
];

$store = chooseStore($storageDriver);
$session = new DemoUserSession($userData);
$session->configurePending($store, $sessionKey, $storageDriver);

RpcAble::http([
    'target' => $session,
    'store' => $store,
    'sessionKey' => $sessionKey,
    'role' => $userData['role'],
])->handle();
