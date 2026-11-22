interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Env {
  STATE_KV?: KVNamespace;
  ENVIRONMENT?: string;
}

const SESSION_TTL_SECONDS = 3600; // 1 hour per-visitor session isolation

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function sanitizeSessionId(raw: string | null): string {
  if (!raw) return 'canonical';
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'canonical';
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const url = new URL(context.request.url);
  const sessionId = sanitizeSessionId(url.searchParams.get('session'));
  const kvKey = `playground:v1:${sessionId}`;

  if (!context.env.STATE_KV) {
    return jsonResponse({
      storage: 'client-fallback',
      session: sessionId,
      state: null,
      note: 'STATE_KV binding not configured; using browser localStorage.'
    });
  }

  const stored = await context.env.STATE_KV.get(kvKey);
  if (!stored) {
    const canonical = await context.env.STATE_KV.get('playground:v1:canonical');
    return jsonResponse({
      storage: 'cloudflare-kv',
      session: sessionId,
      seeded_from_canonical: Boolean(canonical),
      state: canonical ? JSON.parse(canonical) : null
    });
  }

  return jsonResponse({
    storage: 'cloudflare-kv',
    session: sessionId,
    state: JSON.parse(stored)
  });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const url = new URL(context.request.url);
  const sessionId = sanitizeSessionId(url.searchParams.get('session'));

  if (sessionId === 'canonical') {
    return jsonResponse(
      { error: 'Cannot overwrite canonical baseline via public state endpoint. Use /api/admin/reset.' },
      403
    );
  }

  if (!context.env.STATE_KV) {
    return jsonResponse({ storage: 'client-fallback', saved: false });
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload' }, 400);
  }

  const serialized = JSON.stringify(payload);
  if (serialized.length > 256 * 1024) {
    return jsonResponse({ error: 'Payload exceeds 256KB limit' }, 413);
  }

  await context.env.STATE_KV.put(`playground:v1:${sessionId}`, serialized, {
    expirationTtl: SESSION_TTL_SECONDS
  });

  return jsonResponse({
    storage: 'cloudflare-kv',
    session: sessionId,
    ttl_seconds: SESSION_TTL_SECONDS,
    saved: true
  });
}
