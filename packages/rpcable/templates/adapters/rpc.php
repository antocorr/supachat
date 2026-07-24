<?php

require __DIR__ . '/RpcAble.php';

class UserSession
{
    public array $permissions = [
        'ping' => ['user', 'admin'],
        'notifyLater' => ['user', 'admin'],
        'deleteAll' => ['admin'],
    ];

    public RpcAbleCollector $client;
    public RpcAbleReceiver $receiver;

    public function __construct(private array $userData)
    {
        $this->receiver = new RpcAbleReceiver(['target' => $this]);
    }

    public function setClient(RpcAbleCollector $client): void
    {
        $this->client = $client;
    }

    public function ping(): array
    {
        return [
            'pong' => true,
            'userId' => $this->userData['userId'] ?? null,
        ];
    }

    public function notifyLater(string $message): string
    {
        $this->client->toast(['text' => $message]);
        return 'queued';
    }
}

function getUserData(): array
{
    return [
        'userId' => (string) ($_SERVER['HTTP_X_USER_ID'] ?? '42'),
        'role' => (string) ($_SERVER['HTTP_X_ROLE'] ?? 'user'),
        'sessionId' => (string) ($_SERVER['HTTP_X_SESSION_ID'] ?? ''),
    ];
}

$userData = getUserData();
$session = new UserSession($userData);

$sessionKey = $userData['sessionId'] !== ''
    ? $userData['sessionId']
    : ((string) ($_COOKIE[session_name()] ?? $userData['userId']));

$store = new RpcAbleSessionStore();
// $store = new RpcAbleJsonFileStore(__DIR__ . '/../storage/rpcable-pending.json');
// $store = new RpcAbleJsonDirectoryStore(__DIR__ . '/../storage/rpcable-pending');

RpcAble::http([
    'target' => $session,
    'store' => $store,
    'sessionKey' => $sessionKey,
    'role' => $userData['role'],
])->handle();
