/**
 * Global password cache for encrypted conversations.
 *
 * Architecture:
 * - Singleton map: conversationId → { password, unlockedAt }
 * - Password stays in RAM until server restart
 * - Optional disk persistence controlled by PASSWORD_CACHE=1 in .env:
 *   persists to data/.password-cache.json as plaintext passwords
 *   (disabled by default for security).
 *
 * File format (when PASSWORD_CACHE=1 is set):
 *   { "conv-id": "password", ... }
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface CacheEntry {
  password: string;
  unlockedAt: number;
}

class PasswordManager {
  private cache = new Map<string, CacheEntry>();

  /** Path for disk persistence — resolved from the data directory. */
  private diskCachePath: string | null = null;

  constructor() {
    // Disk persistence is opt-in only: set PASSWORD_CACHE=1 in .env
    const passwordCacheEnabled = Bun.env.PASSWORD_CACHE === '1' || Bun.env.PASSWORD_CACHE === 'true';
    if (passwordCacheEnabled) {
      this.diskCachePath = join(process.cwd(), 'data', '.password-cache.json');
      this.loadFromDisk();
    }
  }

  /** Store a password for a conversation. */
  set(conversationId: string, password: string): void {
    this.cache.set(conversationId, {
      password,
      unlockedAt: Date.now(),
    });
    this.maybePersistToDisk();
  }

  /** Retrieve the password for a conversation, or null if not cached. */
  get(conversationId: string): string | null {
    const entry = this.cache.get(conversationId);
    return entry ? entry.password : null;
  }

  /** Check if a password is cached for a conversation. */
  has(conversationId: string): boolean {
    return this.cache.has(conversationId);
  }

  /** Remove a password from the cache. */
  remove(conversationId: string): void {
    this.cache.delete(conversationId);
    this.maybePersistToDisk();
  }

  /** Remove all cached passwords. */
  clear(): void {
    this.cache.clear();
    this.maybePersistToDisk();
  }

  // ---- Optional disk persistence ----

  private maybePersistToDisk(): void {
    if (!this.diskCachePath) return;
    try {
      const obj: Record<string, string> = {};
      for (const [id, entry] of this.cache) {
        obj[id] = entry.password;
      }
      const dir = join(this.diskCachePath, '..');
      mkdirSync(dir, { recursive: true });
      writeFileSync(this.diskCachePath, JSON.stringify(obj, null, 2));
    } catch {
      // Silent fail — cache is ephemeral, disk is a convenience
    }
  }

  private loadFromDisk(): void {
    if (!this.diskCachePath) return;
    try {
      if (existsSync(this.diskCachePath)) {
        const raw = readFileSync(this.diskCachePath, 'utf-8');
        const obj = JSON.parse(raw);
        for (const [id, password] of Object.entries(obj)) {
          if (typeof password === 'string') {
            this.cache.set(id, { password, unlockedAt: Date.now() });
          }
        }
      }
    } catch {
      // Corrupted or missing file — start fresh
    }
  }
}

/** Global singleton instance. */
export const passwordManager = new PasswordManager();
