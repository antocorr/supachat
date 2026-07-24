import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dir, '../..');

// Carica .env dalla root del progetto (Bun lo fa solo dal CWD, ma il server parte da server/)
try {
  const envFile = resolve(projectRoot, '.env');
  const lines = readFileSync(envFile, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    Bun.env[key] = val;
  }
} catch { /* nessun .env nella root, usa le env di sistema */ }

function envNumber(name: string, fallback: number) {
  const value = Number(Bun.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envRatio(name: string, fallback: number) {
  const value = envNumber(name, fallback);
  return value > 1 ? value / 100 : value;
}

export type AppConfig = { host: string; port: number; dbPath: string; dataDir: string };

export function config(): AppConfig {
  return {
    host: Bun.env.HOST || '127.0.0.1',
    port: Number(Bun.env.PORT || 49173),
    dbPath: Bun.env.DB_PATH || 'data/supachat.sqlite',
    dataDir: Bun.env.DATA_DIR || 'data'
  };
}

export const defaults = {
  ai: {
    provider: 'ollama',
    model: 'socialnetwooky/opencrystal:12b',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    toolMode: 'native',
    thinkingMode: 'inactive',
    numCtx: envNumber('OLLAMA_NUM_CTX', 24000),
    temperature: 0.8,
    compactionThreshold: envRatio('COMPACTION_THRESHOLD', 0.4),
    compactionCharsPerToken: envNumber('COMPACTION_CHARS_PER_TOKEN', 4)
  },
  drawThings: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:7860',
    modelsDir: Bun.env.DRAW_THINGS_MODELS_DIR || resolve(homedir(), 'Library/Containers/com.liuliu.draw-things/Data/Documents/Models'),
    width: 512,
    height: 512,
    batchSize: 1,
    textGuidance: 5,
    steps: 8,
    promptPrepend: '',
    promptAppend: '',
    timeoutMs: 120000
  },
  piper: {
    enabled: false,
    voiceDir: resolve(projectRoot, 'server/data/piper-voices'),
    outputDir: resolve(projectRoot, 'server/data/audio'),
    defaultVoice: '',
    maxTextLength: 4000,
    timeoutMs: 30000,
    cleanupPolicy: 'keep'
  },
  kokoro: {
    mode: 'server',
    modelDir: resolve(projectRoot, 'server/data/models/kokoro'),
    dtype: 'q8',
    outputDir: resolve(projectRoot, 'server/data/audio'),
    defaultVoice: 'af_heart',
    maxTextLength: 2000,
    outputMode: 'full'
  },
  tts: {
    enabled: false,
    engine: 'piper'
  }
};

export function mergeSettings(saved: Record<string, any>, base: typeof defaults = defaults) {
  const savedAi = saved.ai || {};
  const savedPiper = saved.piper || {};
  const savedKokoro = saved.kokoro || {};
  return {
    ai: {
      ...base.ai,
      ...savedAi,
      numCtx: envNumber('OLLAMA_NUM_CTX', savedAi.numCtx || base.ai.numCtx),
      temperature: savedAi.temperature ?? base.ai.temperature,
      compactionThreshold: envRatio('COMPACTION_THRESHOLD', savedAi.compactionThreshold || base.ai.compactionThreshold),
      compactionCharsPerToken: envNumber('COMPACTION_CHARS_PER_TOKEN', savedAi.compactionCharsPerToken || base.ai.compactionCharsPerToken)
    },
    drawThings: saved.drawThings || base.drawThings,
    piper: {
      ...base.piper,
      ...savedPiper,
      voiceDir: savedPiper.voiceDir || base.piper.voiceDir,
      outputDir: savedPiper.outputDir || base.piper.outputDir
    },
    kokoro: {
      ...base.kokoro,
      ...savedKokoro,
      modelDir: savedKokoro.modelDir || base.kokoro.modelDir,
      outputDir: savedKokoro.outputDir || base.kokoro.outputDir
    },
    tts: saved.tts || { enabled: !!savedPiper.enabled, engine: 'piper' }
  };
}
