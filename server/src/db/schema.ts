import type {Database} from 'bun:sqlite';
export function migrate(db:Database){db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('active','archived')) DEFAULT 'active',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversation_state(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,active_profile_id TEXT,selected_provider TEXT NOT NULL,selected_model TEXT,selected_tool_mode TEXT,selected_thinking_mode TEXT,auto_mode INTEGER NOT NULL DEFAULT 0,audio_auto_play INTEGER NOT NULL DEFAULT 0,forced_next_agent_id TEXT,last_speaker_agent_id TEXT,queue_json TEXT NOT NULL DEFAULT '[]',allowed_tools_json TEXT NOT NULL DEFAULT '[]',compaction_json TEXT NOT NULL DEFAULT '{"compactedCount":0,"llmSummary":"","pendingCount":0}',restore_on_start INTEGER NOT NULL DEFAULT 0,log_enabled INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,name TEXT NOT NULL,language TEXT NOT NULL DEFAULT 'en',voice TEXT NOT NULL DEFAULT '',speed REAL NOT NULL DEFAULT 1,introduction TEXT NOT NULL DEFAULT '',is_narrator INTEGER NOT NULL DEFAULT 0,selected_model TEXT,thinking_mode TEXT,tools_json TEXT NOT NULL DEFAULT '{"imagen":true,"narrate":false}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,name TEXT NOT NULL,introduction TEXT NOT NULL DEFAULT '',appearance TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,sequence INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN('chat','character_description','tool','system_event')),role TEXT NOT NULL CHECK(role IN('user','assistant','system','tool')),speaker_type TEXT NOT NULL CHECK(speaker_type IN('profile','agent','system','tool')),speaker_id TEXT,speaker_name_snapshot TEXT NOT NULL,content TEXT NOT NULL,rendered_content TEXT,created_at TEXT NOT NULL,UNIQUE(conversation_id,sequence));
CREATE INDEX IF NOT EXISTS idx_messages_kind ON messages(conversation_id,kind);
CREATE TABLE IF NOT EXISTS tool_events(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,tool_call_id TEXT NOT NULL,tool_name TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('proposed','running','succeeded','failed','cancelled')),arguments_json TEXT NOT NULL DEFAULT '{}',result_json TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(conversation_id,tool_call_id));
CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,tool_event_id TEXT REFERENCES tool_events(id) ON DELETE SET NULL,type TEXT NOT NULL CHECK(type IN('image','audio')),mime_type TEXT NOT NULL,filename TEXT NOT NULL,public_url TEXT NOT NULL,size_bytes INTEGER NOT NULL DEFAULT 0,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS story_entries(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN('chapter','fact','setting')),title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sse_events(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,event_name TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sse_events_conversation ON sse_events(conversation_id,id);`);
const cols=db.query("PRAGMA table_info(conversation_state)").all() as any[];
if(!cols.some(c=>c.name==='selected_tool_mode'))db.exec('ALTER TABLE conversation_state ADD COLUMN selected_tool_mode TEXT');
if(!cols.some(c=>c.name==='selected_thinking_mode'))db.exec('ALTER TABLE conversation_state ADD COLUMN selected_thinking_mode TEXT');
if(!cols.some(c=>c.name==='audio_auto_play'))db.exec('ALTER TABLE conversation_state ADD COLUMN audio_auto_play INTEGER NOT NULL DEFAULT 0');
if(!cols.some(c=>c.name==='allowed_tools_json'))db.exec("ALTER TABLE conversation_state ADD COLUMN allowed_tools_json TEXT NOT NULL DEFAULT '[]'");
if(!cols.some(c=>c.name==='compaction_json'))db.exec("ALTER TABLE conversation_state ADD COLUMN compaction_json TEXT NOT NULL DEFAULT '{\"compactedCount\":0,\"llmSummary\":\"\",\"pendingCount\":0}'");
if(!cols.some(c=>c.name==='draw_things_json'))db.exec("ALTER TABLE conversation_state ADD COLUMN draw_things_json TEXT NOT NULL DEFAULT '{}'");
const agentCols=db.query("PRAGMA table_info(agents)").all() as any[];
if(!agentCols.some(c=>c.name==='thinking_mode'))db.exec('ALTER TABLE agents ADD COLUMN thinking_mode TEXT');
if(!agentCols.some(c=>c.name==='tools_json'))db.exec("ALTER TABLE agents ADD COLUMN tools_json TEXT NOT NULL DEFAULT '{\"imagen\":true,\"narrate\":false}'");
if(!agentCols.some(c=>c.name==='kokoro_voice'))db.exec('ALTER TABLE agents ADD COLUMN kokoro_voice TEXT');
if(!agentCols.some(c=>c.name==='appearance'))db.exec('ALTER TABLE agents ADD COLUMN appearance TEXT NOT NULL DEFAULT \'\'');
if(!agentCols.some(c=>c.name==='audio_enabled'))db.exec('ALTER TABLE agents ADD COLUMN audio_enabled INTEGER NOT NULL DEFAULT 1');
if(!agentCols.some(c=>c.name==='auto_select'))db.exec('ALTER TABLE agents ADD COLUMN auto_select INTEGER NOT NULL DEFAULT 1');
if(!agentCols.some(c=>c.name==='response_length'))db.exec('ALTER TABLE agents ADD COLUMN response_length TEXT');
if(!agentCols.some(c=>c.name==='imagen_appearance'))db.exec("ALTER TABLE agents ADD COLUMN imagen_appearance TEXT NOT NULL DEFAULT ''");
const profileCols=db.query('PRAGMA table_info(profiles)').all() as any[];
if(!profileCols.some(c=>c.name==='appearance'))db.exec("ALTER TABLE profiles ADD COLUMN appearance TEXT NOT NULL DEFAULT ''");
// Migration: add 'dice_roll' to messages.kind CHECK constraint
const msgTable = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'").get() as any;
if (msgTable && !msgTable.sql.includes("'dice_roll'")) {
  db.exec(`
    CREATE TABLE messages_new(
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN('chat','character_description','tool','system_event','dice_roll')),
      role TEXT NOT NULL CHECK(role IN('user','assistant','system','tool')),
      speaker_type TEXT NOT NULL CHECK(speaker_type IN('profile','agent','system','tool')),
      speaker_id TEXT,
      speaker_name_snapshot TEXT NOT NULL,
      content TEXT NOT NULL,
      rendered_content TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(conversation_id,sequence)
    );
    INSERT INTO messages_new SELECT * FROM messages;
    DROP TABLE messages;
    ALTER TABLE messages_new RENAME TO messages;
    CREATE INDEX IF NOT EXISTS idx_messages_kind ON messages(conversation_id,kind);
  `);
  // Fix existing system_event dice roll messages
  db.exec("UPDATE messages SET kind='dice_roll' WHERE kind='system_event' AND json_valid(content) AND json_extract(content, '$.type') IS NOT NULL AND json_extract(content, '$.value') IS NOT NULL;");
}

const convCols=db.query('PRAGMA table_info(conversations)').all() as any[];
if(!convCols.some(c=>c.name==='encrypted'))db.exec('ALTER TABLE conversations ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0');
if(!convCols.some(c=>c.name==='password_verifier'))db.exec('ALTER TABLE conversations ADD COLUMN password_verifier TEXT');
}
