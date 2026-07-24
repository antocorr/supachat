export type EventName =
  | 'message_start'
  | 'message_done'
  | 'message_created'
  | 'message_deleted'
  | 'message_updated'
  | 'token'
  | 'tool_call'
  | 'tool_result'
  | 'image_pending'
  | 'image_ready'
  | 'audio_pending'
  | 'audio_ready'
  | 'audio_complete'
  | 'audio_failed'
  | 'state_changed'
  | 'error'
  | 'token_usage'
  | 'compaction'
  | 'dice_challenge'
  | 'dice_cancelled'
  | 'dice_roll';

export type EventClient = {
  cid: string;
  send: (name: EventName, data: any) => void;
};

type StoredEvent = {
  id: number;
  name: EventName;
  data: any;
};

const clients = new Set<EventClient>();
let seq = 0;
let saveEvent: ((cid: string, name: EventName, data: any) => { id: number }) | null = null;
let loadEvents: ((cid: string, since: number) => StoredEvent[]) | null = null;

export function setEventStore(store: {
  save: (cid: string, name: EventName, data: any) => { id: number };
  load: (cid: string, since: number) => StoredEvent[];
}) {
  saveEvent = store.save;
  loadEvents = store.load;
}

function memoryEnvelope(cid: string, data: any) {
  return {
    event_id: String(++seq),
    conversation_id: cid,
    sequence: seq,
    created_at: new Date().toISOString(),
    ...data
  };
}

export function publish(cid: string, name: EventName, data: any) {
  let event = memoryEnvelope(cid, data);
  if (saveEvent) {
    const saved = saveEvent(cid, name, event);
    if (saved) {
      event = { ...event, event_id: String(saved.id), sequence: saved.id };
    }
  }

  for (const client of clients) {
    if (client.cid === cid) {
      try {
        client.send(name, event);
      } catch {
        clients.delete(client);
      }
    }
  }
  return event;
}

export function subscribeEvents(cid: string, send: (name: EventName, data: any) => void, since?: string) {
  const client = { cid, send };
  clients.add(client);

  if (since && loadEvents) {
    for (const event of loadEvents(cid, Number(since))) send(event.name, event.data);
  }

  return client;
}

export function unsubscribeEvents(client: EventClient) {
  clients.delete(client);
}

export function stream(cid: string, since?: string) {
  let client: EventClient | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (keepAlive) clearInterval(keepAlive);
    if (client) clients.delete(client);
  };

  const body = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (name: EventName, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
          try { controller.close(); } catch {}
        }
      };

      client = subscribeEvents(cid, send, since);

      send('state_changed', memoryEnvelope(cid, { status: 'connected' }));

      keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`: keep-alive\n\n`));
        } catch {
          cleanup();
        }
      }, 15000);
    },
    cancel() {
      cleanup();
    }
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    }
  });
}
