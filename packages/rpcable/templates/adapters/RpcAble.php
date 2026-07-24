<?php

/**
 * RpcAble PHP - HTTP adapter for rpcable.
 *
 * No dependencies. Drop this file in your project and require it.
 *
 * Core pieces:
 *   - RpcAbleCollector        -> server-side push queue (JS collector parity)
 *   - RpcAbleReceiver         -> inbound dispatcher with permissions, validation + .set
 *   - RpcAbleHttpAdapter      -> HTTP request helper for plain PHP endpoints
 *   - RpcAbleSessionStore     -> default pending store via $_SESSION
 *   - RpcAbleJsonFileStore    -> pending store in one JSON file
 *   - RpcAbleJsonDirectoryStore -> pending store in many JSON files
 */

interface RpcAblePendingStoreInterface
{
    public function restore(string $sessionKey): array;

    public function save(string $sessionKey, array $pending): void;
}

// ---------------------------------------------------------------------------
// RpcAbleCollector
// ---------------------------------------------------------------------------

class RpcAbleCollector
{
    private array $queue = [];

    public function __construct(array $pending = [])
    {
        $this->restore($pending);
    }

    public function __call(string $method, array $args): void
    {
        $this->_push([$method], $args);
    }

    public function __get(string $name): RpcAbleNamespace
    {
        return new RpcAbleNamespace($this, [$name]);
    }

    public function flush(): array
    {
        $out = $this->queue;
        $this->queue = [];
        return $out;
    }

    public function getPending(): array
    {
        return $this->queue;
    }

    public function clear(): void
    {
        $this->queue = [];
    }

    public function restore(array $pending): void
    {
        foreach (self::normalizeEntries($pending) as $entry) {
            $this->queue[] = $entry;
        }
    }

    public function _push(array $path, array $args): void
    {
        $this->queue[] = [
            'path' => array_values($path),
            'args' => array_values($args),
        ];
    }

    public static function normalizeEntries(array $entries): array
    {
        $normalized = [];

        foreach ($entries as $entry) {
            if (!is_array($entry)) {
                continue;
            }

            $path = [];
            foreach (($entry['path'] ?? []) as $segment) {
                if (is_string($segment) && $segment !== '') {
                    $path[] = $segment;
                }
            }

            if ($path === []) {
                continue;
            }

            $args = $entry['args'] ?? [];
            $normalized[] = [
                'path' => $path,
                'args' => is_array($args) ? array_values($args) : [],
            ];
        }

        return $normalized;
    }
}

class RpcAbleNamespace
{
    public function __construct(
        private RpcAbleCollector $collector,
        private array $prefix
    ) {
    }

    public function __call(string $method, array $args): void
    {
        $this->collector->_push([...$this->prefix, $method], $args);
    }

    public function __get(string $name): self
    {
        return new self($this->collector, [...$this->prefix, $name]);
    }
}

// ---------------------------------------------------------------------------
// RpcAbleReceiver
// ---------------------------------------------------------------------------

class RpcAbleRoleDispatcher
{
    public function __construct(
        private RpcAbleReceiver $receiver,
        private string $role
    ) {
    }

    public function dispatch(array $batch): array
    {
        return $this->receiver->dispatch($batch, ['role' => $this->role]);
    }
}

class RpcAbleReceiver
{
    private const REQUEST_PATH = '--request';
    private const RESPONSE_PATH = '--response';
    private const VALID_LOG_MODES = [false, 'log', 'info', 'warn', 'error', 'throw'];
    private const LOG_KEYS = ['notFound', 'permission', 'forbidden', 'validationFailed'];
    private const LOG_DEFAULTS = ['notFound' => 'error', 'permission' => 'error', 'forbidden' => 'error', 'validationFailed' => 'error'];

    private ?object $target = null;
    private ?array $contract = null;
    private array $log;
    private array $roles = [];

    public function __construct(array $options = [])
    {
        $target = $options['target'] ?? null;
        if ($target !== null) $this->target = $target;
        $contract = $options['contract'] ?? null;
        $this->contract = is_array($contract) ? $contract : null;
        $this->log = self::LOG_DEFAULTS;
        if (is_array($options['logging'] ?? null)) {
            $this->updateSettings('logging', $options['logging']);
        }
    }

    public function updateSettings(string $key, array $data): void
    {
        if ($key === 'logging') {
            foreach (self::LOG_KEYS as $k) {
                if (array_key_exists($k, $data)) {
                    $this->log[$k] = $this->normalizeLogMode($data[$k], self::LOG_DEFAULTS[$k]);
                }
            }
        } elseif ($key === 'permissions') {
            $this->permissions = array_merge($this->permissions ?? [], $data);
        } elseif ($key === 'contract') {
            $this->contract = array_merge($this->contract ?? [], $data);
        }
    }

    public function resetSettings(string $key, ?array $data = null): void
    {
        if ($key === 'logging') {
            $this->log = self::LOG_DEFAULTS;
            if ($data !== null) $this->updateSettings('logging', $data);
        } elseif ($key === 'permissions') {
            $this->permissions = $data;
        } elseif ($key === 'contract') {
            $this->contract = $data;
        }
    }

    public function setRoles(string ...$roles): void
    {
        foreach ($roles as $role) {
            $this->roles[$role] = new RpcAbleRoleDispatcher($this, $role);
        }
    }

    public function __get(string $name): mixed
    {
        if (array_key_exists($name, $this->roles)) {
            return $this->roles[$name];
        }

        trigger_error('Undefined property: ' . static::class . '::$' . $name, E_USER_NOTICE);
        return null;
    }

    public function dispatch(array $batch, array $options = []): array
    {
        if (!is_array($batch)) {
            return [];
        }

        $role = isset($options['role']) && $options['role'] !== null
            ? (string) $options['role']
            : null;

        $results = [];
        foreach ($batch as $entry) {
            $results[] = $this->invokeMethod(
                $role,
                is_array($entry['path'] ?? null) ? $entry['path'] : [],
                is_array($entry['args'] ?? null) ? array_values($entry['args']) : []
            );
        }

        return $results;
    }

    private function invokeMethod(?string $role, array $path, array $args): mixed
    {
        if ($path === []) {
            return null;
        }

        if (count($path) === 1 && $path[0] === self::REQUEST_PATH) {
            return $this->handleRequestEnvelope($role, $args[0] ?? null);
        }

        $current = $this->target;
        $permissions = null;
        $parent = null;
        $propName = null;
        $className = get_class($this->target);

        foreach ($path as $index => $key) {
            $currentVars = is_object($current) ? get_object_vars($current) : [];

            if (
                is_object($current)
                && array_key_exists('permissions', $currentVars)
                && is_array($currentVars['permissions'])
                && array_key_exists($key, $currentVars['permissions'])
            ) {
                $permissions = $currentVars['permissions'];
            }

            if (is_object($current) && array_key_exists($key, $currentVars)) {
                $parent = $current;
                $propName = $key;
                $current = $currentVars[$key];
                continue;
            }

            if (is_object($current) && method_exists($current, $key)) {
                $parent = $current;
                $propName = $key;
                $current = \Closure::fromCallable([$current, $key]);
                continue;
            }

            if (is_array($current) && array_key_exists($key, $current)) {
                $parent = $current;
                $propName = $key;
                $current = $current[$key];
                continue;
            }

            if ($key === 'set' && $index === count($path) - 1 && is_object($parent) && $propName !== null) {
                $value = $args[0] ?? null;
                $parent->$propName = $value;
                return $value;
            }

            $this->emitLog('notFound', '[RpcAble] ' . implode('.', $path) . ' not found in ' . $className);
            return null;
        }

        if ($role !== null && $permissions !== null) {
            $allowedRoles = $permissions[$propName] ?? null;
            $allowed = is_array($allowedRoles) ? $allowedRoles : [];
            if (!in_array($role, $allowed, true)) {
                $this->emitLog('forbidden', '[RpcAble] access denied: ' . implode('.', $path) . ' for role "' . $role . '"');
                return null;
            }
        }

        $parentVars = is_object($parent) ? get_object_vars($parent) : [];
        if (
            $role !== null
            && is_object($parent)
            && array_key_exists('permissions', $parentVars)
            && is_array($parentVars['permissions'])
            && !array_key_exists((string) $propName, $parentVars['permissions'])
        ) {
            $this->emitLog('permission', '[RpcAble] access denied: ' . implode('.', $path) . ' not listed in permissions');
            return null;
        }

        if ($this->contract !== null) {
            $key = implode('.', $path);
            $definition = $this->contract[$key] ?? null;
            if (is_array($definition) && array_key_exists('inputSchema', $definition)) {
                $check = self::validateSchema($definition['inputSchema'], $args[0] ?? null);
                if (($check['valid'] ?? false) !== true) {
                    $message = '[RpcAble] validation failed for "' . $key . '": ' . ($check['error'] ?? 'invalid input');
                    $this->emitLog('validationFailed', $message);
                    return null;
                }
            }
        }

        if (is_callable($current)) {
            $callArgs = $args;
            if ($role !== null) {
                $callArgs[] = $role;
            }
            return $current(...$callArgs);
        }

        return $current;
    }

    private static function validateSchema(mixed $schema, mixed $value): array
    {
        if ($schema === true) {
            return ['valid' => true];
        }

        if ($schema === false) {
            return ['valid' => false, 'error' => 'schema is false'];
        }

        if (!is_array($schema)) {
            return ['valid' => true];
        }

        if (array_key_exists('enum', $schema) && is_array($schema['enum'])) {
            $matched = false;
            foreach ($schema['enum'] as $enumValue) {
                if ($enumValue === $value) {
                    $matched = true;
                    break;
                }
            }

            if (!$matched) {
                return [
                    'valid' => false,
                    'error' => 'value must be one of [' . self::stringifySchemaValues($schema['enum']) . ']',
                ];
            }
        }

        if (array_key_exists('type', $schema)) {
            $types = is_array($schema['type']) ? $schema['type'] : [$schema['type']];
            $matches = false;

            foreach ($types as $type) {
                if (self::matchesSchemaType($type, $value)) {
                    $matches = true;
                    break;
                }
            }

            if (!$matches) {
                return [
                    'valid' => false,
                    'error' => 'expected type "' . self::stringifySchemaType($schema['type']) . '" but got ' . self::describeValueType($value),
                ];
            }
        }

        if (is_string($value)) {
            $length = strlen($value);
            if (array_key_exists('minLength', $schema) && is_numeric($schema['minLength']) && $length < (int) $schema['minLength']) {
                return [
                    'valid' => false,
                    'error' => 'minLength is ' . (int) $schema['minLength'] . ', got ' . $length,
                ];
            }

            if (array_key_exists('maxLength', $schema) && is_numeric($schema['maxLength']) && $length > (int) $schema['maxLength']) {
                return [
                    'valid' => false,
                    'error' => 'maxLength is ' . (int) $schema['maxLength'] . ', got ' . $length,
                ];
            }
        }

        if (is_int($value) || is_float($value)) {
            if (array_key_exists('minimum', $schema) && is_numeric($schema['minimum']) && $value < $schema['minimum']) {
                return [
                    'valid' => false,
                    'error' => 'minimum is ' . self::stringifySchemaValue($schema['minimum']) . ', got ' . self::stringifySchemaValue($value),
                ];
            }

            if (array_key_exists('maximum', $schema) && is_numeric($schema['maximum']) && $value > $schema['maximum']) {
                return [
                    'valid' => false,
                    'error' => 'maximum is ' . self::stringifySchemaValue($schema['maximum']) . ', got ' . self::stringifySchemaValue($value),
                ];
            }
        }

        if (self::isObjectValue($value)) {
            if (array_key_exists('required', $schema) && is_array($schema['required'])) {
                foreach ($schema['required'] as $requiredKey) {
                    $requiredKey = (string) $requiredKey;
                    if (!self::hasObjectProperty($value, $requiredKey)) {
                        return [
                            'valid' => false,
                            'error' => 'missing required property "' . $requiredKey . '"',
                        ];
                    }
                }
            }

            if (array_key_exists('properties', $schema) && is_array($schema['properties'])) {
                foreach ($schema['properties'] as $property => $propertySchema) {
                    $property = (string) $property;
                    if (self::hasObjectProperty($value, $property)) {
                        $check = self::validateSchema($propertySchema, self::getObjectProperty($value, $property));
                        if (($check['valid'] ?? false) !== true) {
                            return [
                                'valid' => false,
                                'error' => 'property "' . $property . '": ' . ($check['error'] ?? 'invalid value'),
                            ];
                        }
                    }
                }
            }

            if (($schema['additionalProperties'] ?? null) === false && is_array($schema['properties'] ?? null)) {
                foreach (self::getObjectKeys($value) as $property) {
                    if (!array_key_exists($property, $schema['properties'])) {
                        return [
                            'valid' => false,
                            'error' => 'additional property "' . $property . '" not allowed',
                        ];
                    }
                }
            }
        }

        if (self::isArrayValue($value) && array_key_exists('items', $schema)) {
            foreach ($value as $index => $item) {
                $check = self::validateSchema($schema['items'], $item);
                if (($check['valid'] ?? false) !== true) {
                    return [
                        'valid' => false,
                        'error' => 'item[' . $index . ']: ' . ($check['error'] ?? 'invalid value'),
                    ];
                }
            }
        }

        return ['valid' => true];
    }

    private static function matchesSchemaType(mixed $type, mixed $value): bool
    {
        if (!is_string($type)) {
            return true;
        }

        return match ($type) {
            'string' => is_string($value),
            'number' => (is_int($value) || is_float($value)) && !(is_float($value) && is_nan($value)),
            'integer' => is_int($value),
            'boolean' => is_bool($value),
            'null' => $value === null,
            'array' => self::isArrayValue($value),
            'object' => self::isObjectValue($value),
            default => true,
        };
    }

    private static function describeValueType(mixed $value): string
    {
        if ($value === null) {
            return 'null';
        }

        if (self::isArrayValue($value)) {
            return 'array';
        }

        if (self::isObjectValue($value)) {
            return 'object';
        }

        if (is_string($value)) {
            return 'string';
        }

        if (is_bool($value)) {
            return 'boolean';
        }

        if (is_int($value) || is_float($value)) {
            return 'number';
        }

        return get_debug_type($value);
    }

    private static function stringifySchemaType(mixed $type): string
    {
        if (is_array($type)) {
            return implode(',', array_map(static fn($item) => (string) $item, $type));
        }

        return (string) $type;
    }

    private static function stringifySchemaValues(array $values): string
    {
        return implode(', ', array_map([self::class, 'stringifySchemaValue'], $values));
    }

    private static function stringifySchemaValue(mixed $value): string
    {
        if ($value === null) {
            return 'null';
        }

        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }

        if (is_string($value) || is_int($value) || is_float($value)) {
            return (string) $value;
        }

        $encoded = json_encode($value, JSON_UNESCAPED_SLASHES);
        return $encoded === false ? get_debug_type($value) : $encoded;
    }

    private static function isArrayValue(mixed $value): bool
    {
        return is_array($value) && array_is_list($value);
    }

    private static function isObjectValue(mixed $value): bool
    {
        return is_object($value) || (is_array($value) && !array_is_list($value));
    }

    private static function hasObjectProperty(mixed $value, string $property): bool
    {
        if (is_array($value)) {
            return array_key_exists($property, $value);
        }

        return is_object($value) && property_exists($value, $property);
    }

    private static function getObjectProperty(mixed $value, string $property): mixed
    {
        if (is_array($value)) {
            return $value[$property] ?? null;
        }

        return is_object($value) ? ($value->$property ?? null) : null;
    }

    private static function getObjectKeys(mixed $value): array
    {
        if (is_array($value)) {
            return array_map(static fn($key) => (string) $key, array_keys($value));
        }

        return is_object($value)
            ? array_map(static fn($key) => (string) $key, array_keys(get_object_vars($value)))
            : [];
    }

    private function handleRequestEnvelope(?string $role, mixed $requestPayload): mixed
    {
        if (!is_array($requestPayload)) {
            return null;
        }

        $id = $requestPayload['id'] ?? null;
        $path = $requestPayload['path'] ?? null;
        $args = $requestPayload['args'] ?? [];

        if (!is_string($id) || !is_array($path)) {
            return null;
        }

        try {
            $result = $this->invokeMethod($role, $path, is_array($args) ? array_values($args) : []);
            $this->sendResponse(['id' => $id, 'ok' => true, 'result' => $result]);
            return $result;
        } catch (\Throwable $error) {
            $this->sendResponse([
                'id' => $id,
                'ok' => false,
                'error' => $this->serializeError($error),
            ]);
            return null;
        }
    }

    private function sendResponse(array $payload): void
    {
        $client = $this->resolveTargetClient();
        if (!$client instanceof RpcAbleCollector) {
            return;
        }

        $client->_push([self::RESPONSE_PATH], [$payload]);
    }

    private function resolveTargetClient(): ?RpcAbleCollector
    {
        if (method_exists($this->target, 'getClient')) {
            $client = $this->target->getClient();
            if ($client instanceof RpcAbleCollector) {
                return $client;
            }
        }

        $vars = get_object_vars($this->target);
        $client = $vars['client'] ?? null;
        return $client instanceof RpcAbleCollector ? $client : null;
    }

    private function serializeError(\Throwable $error): array
    {
        return [
            'name' => $error::class,
            'message' => $error->getMessage(),
        ];
    }

    private function normalizeLogMode(mixed $value, string $fallback): mixed
    {
        if ($value === null) {
            return $fallback;
        }

        return in_array($value, self::VALID_LOG_MODES, true) ? $value : $fallback;
    }

    private function emitLog(string $kind, string $message): void
    {
        $mode = $this->log[$kind] ?? 'error';
        if ($mode === false) return;
        if ($mode === 'throw') throw new \RuntimeException($message);
        if (($mode === 'log' || $mode === 'info') && defined('STDOUT')) {
            fwrite(STDOUT, $message . PHP_EOL);
            return;
        }
        if (defined('STDERR')) {
            fwrite(STDERR, $message . PHP_EOL);
            return;
        }
        error_log($message);
    }
}

// ---------------------------------------------------------------------------
// Pending stores
// ---------------------------------------------------------------------------

class RpcAbleSessionStore implements RpcAblePendingStoreInterface
{
    public function __construct(private string $namespace = '_rpcable')
    {
    }

    public function restore(string $sessionKey): array
    {
        $this->ensureSession();
        $pending = $_SESSION[$this->namespace][$sessionKey] ?? [];
        return is_array($pending) ? RpcAbleCollector::normalizeEntries($pending) : [];
    }

    public function save(string $sessionKey, array $pending): void
    {
        $this->ensureSession();
        if ($pending === []) {
            unset($_SESSION[$this->namespace][$sessionKey]);
            return;
        }

        $_SESSION[$this->namespace][$sessionKey] = RpcAbleCollector::normalizeEntries($pending);
    }

    public function getCurrentSessionKey(): string
    {
        $this->ensureSession();
        return session_id();
    }

    public static function restorePending(string $sessionKey, string $namespace = '_rpcable'): array
    {
        return (new self($namespace))->restore($sessionKey);
    }

    public static function savePending(string $sessionKey, array $pending, string $namespace = '_rpcable'): void
    {
        (new self($namespace))->save($sessionKey, $pending);
    }

    private function ensureSession(): void
    {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
    }
}

class RpcAbleJsonFileStore implements RpcAblePendingStoreInterface
{
    public function __construct(private string $filePath)
    {
    }

    public function restore(string $sessionKey): array
    {
        return $this->withLockedFile(function ($handle) use ($sessionKey) {
            $data = $this->readAll($handle);
            $pending = $data[$sessionKey] ?? [];
            return is_array($pending) ? RpcAbleCollector::normalizeEntries($pending) : [];
        });
    }

    public function save(string $sessionKey, array $pending): void
    {
        $this->withLockedFile(function ($handle) use ($sessionKey, $pending) {
            $data = $this->readAll($handle);

            if ($pending === []) {
                unset($data[$sessionKey]);
            } else {
                $data[$sessionKey] = RpcAbleCollector::normalizeEntries($pending);
            }

            $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            if ($json === false) {
                throw new RuntimeException('[RpcAble] failed to encode pending JSON file');
            }

            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, $json);
            fflush($handle);
        });
    }

    private function withLockedFile(callable $callback): mixed
    {
        $dir = dirname($this->filePath);
        if (!is_dir($dir) && !mkdir($dir, 0777, true) && !is_dir($dir)) {
            throw new RuntimeException('[RpcAble] failed to create directory for JSON store');
        }

        $handle = fopen($this->filePath, 'c+');
        if ($handle === false) {
            throw new RuntimeException('[RpcAble] failed to open JSON store file');
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                throw new RuntimeException('[RpcAble] failed to lock JSON store file');
            }

            return $callback($handle);
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    private function readAll($handle): array
    {
        rewind($handle);
        $raw = stream_get_contents($handle);
        if (!is_string($raw) || trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
}

class RpcAbleJsonDirectoryStore implements RpcAblePendingStoreInterface
{
    public function __construct(private string $directoryPath)
    {
    }

    public function restore(string $sessionKey): array
    {
        $filePath = $this->pathForKey($sessionKey);
        if (!is_file($filePath)) {
            return [];
        }

        $raw = file_get_contents($filePath);
        if (!is_string($raw) || trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        return is_array($decoded) ? RpcAbleCollector::normalizeEntries($decoded) : [];
    }

    public function save(string $sessionKey, array $pending): void
    {
        if (!is_dir($this->directoryPath) && !mkdir($this->directoryPath, 0777, true) && !is_dir($this->directoryPath)) {
            throw new RuntimeException('[RpcAble] failed to create JSON directory store');
        }

        $filePath = $this->pathForKey($sessionKey);
        if ($pending === []) {
            if (is_file($filePath)) {
                unlink($filePath);
            }
            return;
        }

        $json = json_encode(RpcAbleCollector::normalizeEntries($pending), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            throw new RuntimeException('[RpcAble] failed to encode JSON directory store payload');
        }

        $tmpPath = $filePath . '.tmp';
        if (file_put_contents($tmpPath, $json, LOCK_EX) === false) {
            throw new RuntimeException('[RpcAble] failed to write JSON directory store payload');
        }

        rename($tmpPath, $filePath);
    }

    private function pathForKey(string $sessionKey): string
    {
        return rtrim($this->directoryPath, DIRECTORY_SEPARATOR)
            . DIRECTORY_SEPARATOR
            . rawurlencode($sessionKey)
            . '.json';
    }
}

// ---------------------------------------------------------------------------
// RpcAbleHttpAdapter
// ---------------------------------------------------------------------------

class RpcAbleHttpAdapter
{
    private RpcAbleReceiver $receiver;
    private RpcAbleCollector $client;
    private ?object $target;
    private ?RpcAblePendingStoreInterface $store;
    private ?string $sessionKey;
    private ?string $role;
    private string $requestMethod;
    private bool $restored = false;
    private array $deferredPending = [];

    public function __construct(array $options)
    {
        $this->target = isset($options['target']) && is_object($options['target'])
            ? $options['target']
            : null;

        $this->client = $options['client'] ?? new RpcAbleCollector();
        if (!$this->client instanceof RpcAbleCollector) {
            throw new InvalidArgumentException('[RpcAble] client must be an instance of RpcAbleCollector');
        }

        if (isset($options['receiver'])) {
            if (!$options['receiver'] instanceof RpcAbleReceiver) {
                throw new InvalidArgumentException('[RpcAble] receiver must be an instance of RpcAbleReceiver');
            }
            $this->receiver = $options['receiver'];
        } else {
            if (!$this->target) {
                throw new InvalidArgumentException('[RpcAble] target or receiver is required');
            }
            $receiverSettings = $options['receiverSettings'] ?? [];
            $this->receiver = new RpcAbleReceiver(array_merge(
                ['target' => $this->target],
                $receiverSettings
            ));
        }

        if (array_key_exists('store', $options)) {
            $store = $options['store'];
            if ($store !== null && !$store instanceof RpcAblePendingStoreInterface) {
                throw new InvalidArgumentException('[RpcAble] store must implement RpcAblePendingStoreInterface');
            }
            $this->store = $store;
        } else {
            $this->store = new RpcAbleSessionStore();
        }

        $this->sessionKey = isset($options['sessionKey']) && $options['sessionKey'] !== ''
            ? (string) $options['sessionKey']
            : null;

        $this->role = isset($options['role']) && $options['role'] !== null
            ? (string) $options['role']
            : null;

        $this->requestMethod = strtoupper((string) ($options['requestMethod'] ?? 'POST'));

        $this->bindTargetTransport();
    }

    public function getClient(): RpcAbleCollector
    {
        return $this->client;
    }

    public function getReceiver(): RpcAbleReceiver
    {
        return $this->receiver;
    }

    public function dispatch(array $batch): array
    {
        $this->restorePending();

        try {
            $results = $this->receiver->dispatch($batch, ['role' => $this->role]);
        } catch (\Throwable $error) {
            $this->persistPending();
            throw $error;
        }

        $payload = [
            'results' => $results,
            'push' => $this->client->flush(),
        ];

        $this->persistPending();
        return $payload;
    }

    public function handle(): void
    {
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        if ($method !== $this->requestMethod) {
            $this->respondJson(['error' => 'Method not allowed'], 405);
            return;
        }

        $input = file_get_contents('php://input');
        $batch = json_decode(is_string($input) ? $input : '', true);

        if (!is_array($batch)) {
            $this->respondJson(['error' => 'Expected a JSON array'], 400);
            return;
        }

        try {
            $this->respondJson($this->dispatch($batch));
        } catch (\Throwable $error) {
            $this->respondJson([
                'error' => [
                    'name' => $error::class,
                    'message' => $error->getMessage(),
                ],
            ], 500);
        }
    }

    public function respondJson(array $payload, int $statusCode = 200): void
    {
        http_response_code($statusCode);
        header('Content-Type: application/json');
        echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    }

    public function queuePending(array $entries): void
    {
        foreach (RpcAbleCollector::normalizeEntries($entries) as $entry) {
            $this->deferredPending[] = $entry;
        }
    }

    public function clearPending(): void
    {
        $this->client->clear();
        $this->deferredPending = [];

        if (!$this->store) {
            return;
        }

        $sessionKey = $this->resolveSessionKey();
        if ($sessionKey === null) {
            return;
        }

        $this->store->save($sessionKey, []);
    }

    private function bindTargetTransport(): void
    {
        if (!$this->target) {
            return;
        }

        if (method_exists($this->target, 'setClient')) {
            $this->target->setClient($this->client);
        } else {
            $this->trySetProperty($this->target, 'client', $this->client);
        }

        if (method_exists($this->target, 'setReceiver')) {
            $this->target->setReceiver($this->receiver);
        } else {
            $this->trySetProperty($this->target, 'receiver', $this->receiver);
        }

        if (method_exists($this->target, 'setHttpAdapter')) {
            $this->target->setHttpAdapter($this);
        } else {
            $this->trySetProperty($this->target, 'httpAdapter', $this);
        }
    }

    private function trySetProperty(object $target, string $property, mixed $value): void
    {
        if (!property_exists($target, $property)) {
            return;
        }

        try {
            $target->$property = $value;
        } catch (\Throwable) {
        }
    }

    private function restorePending(): void
    {
        if ($this->restored) {
            return;
        }

        $this->restored = true;
        if (!$this->store) {
            return;
        }

        $sessionKey = $this->resolveSessionKey();
        if ($sessionKey === null) {
            return;
        }

        $this->client->restore($this->store->restore($sessionKey));
    }

    private function persistPending(): void
    {
        if (!$this->store) {
            return;
        }

        $sessionKey = $this->resolveSessionKey();
        if ($sessionKey === null) {
            return;
        }

        $pending = array_merge($this->client->getPending(), $this->deferredPending);
        $this->store->save($sessionKey, $pending);
    }

    private function resolveSessionKey(): ?string
    {
        if ($this->sessionKey !== null && $this->sessionKey !== '') {
            return $this->sessionKey;
        }

        if ($this->store instanceof RpcAbleSessionStore) {
            return $this->store->getCurrentSessionKey();
        }

        return null;
    }
}

// ---------------------------------------------------------------------------
// RpcAble facade
// ---------------------------------------------------------------------------

class RpcAble
{
    public static function http(array $options): RpcAbleHttpAdapter
    {
        return new RpcAbleHttpAdapter($options);
    }

    public static function handleRequest(
        RpcAbleReceiver $receiver,
        RpcAbleCollector $client,
        array $options = []
    ): void {
        $adapter = new RpcAbleHttpAdapter([
            'receiver' => $receiver,
            'client' => $client,
            'store' => $options['store'] ?? new RpcAbleSessionStore(),
            'sessionKey' => $options['sessionKey'] ?? null,
            'role' => $options['role'] ?? null,
            'requestMethod' => $options['requestMethod'] ?? 'POST',
        ]);

        $adapter->handle();
    }
}
