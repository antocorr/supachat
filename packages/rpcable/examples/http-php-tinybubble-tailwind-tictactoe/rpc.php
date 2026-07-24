<?php

declare(strict_types=1);

require __DIR__ . '/../../templates/adapters/RpcAble.php';

const APP_NAMESPACE = 'rpcable_tictactoe_demo';

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

function headerValue(string $name, string $fallback = ''): string
{
    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return trim((string) ($_SERVER[$serverKey] ?? $fallback));
}

function normalizeRoomId(?string $value): string
{
    $roomId = strtolower((string) $value);
    $roomId = preg_replace('/[^a-z0-9-]+/', '-', $roomId ?? '');
    $roomId = trim((string) $roomId, '-');

    return $roomId !== '' ? $roomId : 'room-demo';
}

function normalizeSeat(?string $value): string
{
    return $value === 'lime' ? 'lime' : 'sun';
}

function normalizePlayerName(?string $value, string $fallback): string
{
    $name = preg_replace('/\s+/', ' ', trim((string) $value));
    $name = $name === null ? '' : $name;

    if ($name === '') {
        $name = $fallback;
    }

    if (function_exists('mb_substr')) {
        $name = mb_substr($name, 0, 24);
    } else {
        $name = substr($name, 0, 24);
    }

    return $name;
}

function roomSessionKey(string $roomId, string $seat): string
{
    return 'room:' . $roomId . ':seat:' . $seat;
}

function otherSeat(string $seat): string
{
    return $seat === 'lime' ? 'sun' : 'lime';
}

function nowIso(): string
{
    return gmdate('c');
}

function seatProfile(string $seat, ?string $name = null): array
{
    $profiles = [
        'sun' => [
            'seat' => 'sun',
            'name' => 'Giulia',
            'symbol' => 'X',
            'accent' => 'sun',
        ],
        'lime' => [
            'seat' => 'lime',
            'name' => 'Marco',
            'symbol' => 'O',
            'accent' => 'lime',
        ],
    ];

    $profile = $profiles[$seat] ?? $profiles['sun'];
    if ($name !== null && $name !== '') {
        $profile['name'] = $name;
    }

    return $profile;
}

function buildChatEntry(string $seat, string $text, ?string $optimisticKey = null): array
{
    return [
        'id' => uniqid('msg_', true),
        'seat' => $seat,
        'text' => $text,
        'createdAt' => nowIso(),
        'optimisticKey' => $optimisticKey,
    ];
}

function winningLine(array $board): array
{
    $lines = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6],
    ];

    foreach ($lines as $line) {
        [$a, $b, $c] = $line;
        if ($board[$a] !== '' && $board[$a] === $board[$b] && $board[$b] === $board[$c]) {
            return $line;
        }
    }

    return [];
}

final class TicTacToeRoomRepository
{
    public function load(string $roomId): array
    {
        if (!isset($_SESSION[APP_NAMESPACE]) || !is_array($_SESSION[APP_NAMESPACE])) {
            $_SESSION[APP_NAMESPACE] = [];
        }

        if (!isset($_SESSION[APP_NAMESPACE]['rooms']) || !is_array($_SESSION[APP_NAMESPACE]['rooms'])) {
            $_SESSION[APP_NAMESPACE]['rooms'] = [];
        }

        $rooms = &$_SESSION[APP_NAMESPACE]['rooms'];
        if (!isset($rooms[$roomId]) || !is_array($rooms[$roomId])) {
            $rooms[$roomId] = $this->makeRoom($roomId);
        }

        return $rooms[$roomId];
    }

    public function save(string $roomId, array $room): void
    {
        $_SESSION[APP_NAMESPACE]['rooms'][$roomId] = $room;
    }

    private function makeRoom(string $roomId): array
    {
        return [
            'roomId' => $roomId,
            'createdAt' => nowIso(),
            'updatedAt' => nowIso(),
            'round' => 1,
            'turn' => 'sun',
            'nextStarter' => 'lime',
            'status' => 'playing',
            'winner' => null,
            'winningLine' => [],
            'turnStartedAt' => nowIso(),
            'board' => array_fill(0, 9, ''),
            'scores' => [
                'sun' => 0,
                'lime' => 0,
            ],
            'players' => [
                'sun' => seatProfile('sun'),
                'lime' => seatProfile('lime'),
            ],
            'lastAction' => 'Match ready. Sun opens the first move.',
            'chat' => [],
        ];
    }
}

final class TicTacToeUserSession
{
    public array $permissions = [
        'bootstrap' => ['user'],
        'sync' => ['user'],
        'makeMove' => ['user'],
        'sendChat' => ['user'],
        'nextRound' => ['user'],
    ];

    public RpcAbleCollector $client;
    public RpcAbleReceiver $receiver;

    public function __construct(
        private array $userData,
        private string $roomId,
        private string $seat,
        private string $sessionKey,
        private TicTacToeRoomRepository $repository,
        private RpcAblePendingStoreInterface $pendingStore
    ) {
        $this->receiver = new RpcAbleReceiver(['target' => $this]);
    }

    public function setClient(RpcAbleCollector $client): void
    {
        $this->client = $client;
    }

    public function bootstrap(): array
    {
        $room = $this->repository->load($this->roomId);
        $room = $this->syncPlayerProfile($room);
        return $this->snapshotFor($room, $this->seat);
    }

    public function sync(): void
    {
        $room = $this->repository->load($this->roomId);
        $room = $this->syncPlayerProfile($room);
        $this->pushToSelf($room, 'sync');
    }

    public function makeMove(int $index): void
    {
        if ($index < 0 || $index > 8) {
            throw new RuntimeException('Cell out of range.');
        }

        $room = $this->syncPlayerProfile($this->repository->load($this->roomId));

        if ($room['status'] !== 'playing') {
            throw new RuntimeException('Round finished. Tap Rigioca.');
        }

        if ($room['turn'] !== $this->seat) {
            throw new RuntimeException('Wait for your turn.');
        }

        if (($room['board'][$index] ?? '') !== '') {
            throw new RuntimeException('That tile is already taken.');
        }

        $room['board'][$index] = $room['players'][$this->seat]['symbol'];
        $room['updatedAt'] = nowIso();
        $room['turnStartedAt'] = nowIso();
        $room['lastAction'] = $room['players'][$this->seat]['name'] . ' marked tile ' . ($index + 1) . '.';

        $line = winningLine($room['board']);
        if ($line !== []) {
            $room['status'] = 'won';
            $room['winner'] = $this->seat;
            $room['winningLine'] = $line;
            $room['scores'][$this->seat] += 1;
            $room['lastAction'] = $room['players'][$this->seat]['name'] . ' won round ' . $room['round'] . '.';
        } elseif (!in_array('', $room['board'], true)) {
            $room['status'] = 'draw';
            $room['winner'] = null;
            $room['winningLine'] = [];
            $room['lastAction'] = 'Board full. It is a draw.';
        } else {
            $room['turn'] = otherSeat($this->seat);
        }

        $this->repository->save($this->roomId, $room);
        $this->pushToSelf($room, 'move');
        $this->queueUpdateForSeat($room, otherSeat($this->seat), 'move');
    }

    public function sendChat(array $payload = []): void
    {
        $text = trim((string) ($payload['text'] ?? ''));
        $optimisticKey = trim((string) ($payload['optimisticKey'] ?? ''));

        if (function_exists('mb_substr')) {
            $text = mb_substr($text, 0, 160);
        } else {
            $text = substr($text, 0, 160);
        }

        if ($text === '') {
            throw new RuntimeException('Write a message first.');
        }

        $room = $this->syncPlayerProfile($this->repository->load($this->roomId));
        $room['chat'][] = buildChatEntry($this->seat, $text, $optimisticKey !== '' ? $optimisticKey : null);
        $room['chat'] = array_slice($room['chat'], -40);
        $room['updatedAt'] = nowIso();
        $room['lastAction'] = $room['players'][$this->seat]['name'] . ' sent a message.';

        $this->repository->save($this->roomId, $room);
        $this->pushToSelf($room, 'chat');
        $this->queueUpdateForSeat($room, otherSeat($this->seat), 'chat');
    }

    public function nextRound(): void
    {
        $room = $this->syncPlayerProfile($this->repository->load($this->roomId));
        $starter = $room['nextStarter'] ?? otherSeat($room['turn'] ?? 'sun');

        $room['round'] += 1;
        $room['board'] = array_fill(0, 9, '');
        $room['turn'] = $starter;
        $room['nextStarter'] = otherSeat($starter);
        $room['status'] = 'playing';
        $room['winner'] = null;
        $room['winningLine'] = [];
        $room['updatedAt'] = nowIso();
        $room['turnStartedAt'] = nowIso();
        $room['lastAction'] = 'Round ' . $room['round'] . ' started. ' . $room['players'][$starter]['name'] . ' opens.';

        $this->repository->save($this->roomId, $room);
        $this->pushToSelf($room, 'next-round');
        $this->queueUpdateForSeat($room, otherSeat($this->seat), 'next-round');
    }

    private function syncPlayerProfile(array $room): array
    {
        $currentName = (string) ($room['players'][$this->seat]['name'] ?? '');
        $nextName = (string) ($this->userData['playerName'] ?? $currentName);

        if ($nextName !== '' && $nextName !== $currentName) {
            $room['players'][$this->seat]['name'] = $nextName;
            $room['updatedAt'] = nowIso();
            $room['lastAction'] = $nextName . ' joined the room.';
            $this->repository->save($this->roomId, $room);
            $this->queueUpdateForSeat($room, otherSeat($this->seat), 'profile');
        }

        return $room;
    }

    private function snapshotFor(array $room, string $viewerSeat): array
    {
        return [
            'roomId' => $this->roomId,
            'sessionKey' => roomSessionKey($this->roomId, $viewerSeat),
            'viewerSeat' => $viewerSeat,
            'viewer' => $room['players'][$viewerSeat],
            'opponentSeat' => otherSeat($viewerSeat),
            'room' => $room,
            'pollingSeconds' => 5,
            'serverNow' => nowIso(),
            'transport' => 'http-php-session',
            'role' => $this->userData['role'],
        ];
    }

    private function pushToSelf(array $room, string $event): void
    {
        $this->client->sessionUpdated([
            'event' => $event,
            'state' => $this->snapshotFor($room, $this->seat),
        ]);
    }

    private function queueUpdateForSeat(array $room, string $viewerSeat, string $event): void
    {
        $pendingKey = roomSessionKey($this->roomId, $viewerSeat);
        $pending = $this->pendingStore->restore($pendingKey);
        $pending[] = [
            'path' => ['sessionUpdated'],
            'args' => [[
                'event' => $event,
                'state' => $this->snapshotFor($room, $viewerSeat),
            ]],
        ];

        $this->pendingStore->save($pendingKey, $pending);
    }
}

$roomId = normalizeRoomId(headerValue('x-room-id', 'room-demo'));
$seat = normalizeSeat(headerValue('x-seat', 'sun'));
$fallbackName = $seat === 'sun' ? 'Giulia' : 'Marco';
$playerName = normalizePlayerName(headerValue('x-player-name', $fallbackName), $fallbackName);

$userData = [
    'userId' => $seat,
    'role' => 'user',
    'roomId' => $roomId,
    'playerName' => $playerName,
];

$store = new RpcAbleSessionStore();
$sessionKey = roomSessionKey($roomId, $seat);
$repository = new TicTacToeRoomRepository();
$session = new TicTacToeUserSession($userData, $roomId, $seat, $sessionKey, $repository, $store);

RpcAble::http([
    'target' => $session,
    'store' => $store,
    'sessionKey' => $sessionKey,
    'role' => $userData['role'],
])->handle();
