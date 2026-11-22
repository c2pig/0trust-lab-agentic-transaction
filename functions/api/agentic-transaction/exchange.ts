import {
  AGENTIC_SESSION_TTL_SECONDS,
  AGENTIC_STEP1_TTL_SECONDS,
  type AgenticTransactionEnv,
  buildStage1ExchangeResult,
  checkAndIncrementDailyCap,
  jsonResponse,
  loadAgenticSession,
  saveAgenticSession
} from './_shared';
import type { AgentPersona } from '../../../src/types';

type AttackMode = 'NONE' | 'RAW_JWT_FORWARD' | 'ID_JAG_WRONG_AUD' | 'SPOOF_GCP_SA';

const VALID_ATTACK_MODES = new Set<AttackMode>([
  'NONE',
  'RAW_JWT_FORWARD',
  'ID_JAG_WRONG_AUD',
  'SPOOF_GCP_SA'
]);

const VALID_PERSONAS = new Set<AgentPersona>(['erp-operator', 'support-agent']);

export async function onRequestPost(context: {
  request: Request;
  env: AgenticTransactionEnv;
}): Promise<Response> {
  let body: {
    sessionId?: string;
    persona?: AgentPersona;
    order_id?: string;
    attack_mode?: AttackMode;
  } = {};

  try {
    const rawText = await context.request.text();
    if (rawText.length > 64 * 1024) {
      return jsonResponse({ error: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 64KB limit.' }, 413);
    }
    if (rawText.trim()) {
      body = JSON.parse(rawText) as typeof body;
    }
  } catch {
    return jsonResponse({ error: 'INVALID_JSON', message: 'Request body must be valid JSON.' }, 400);
  }

  const rawSid = context.request.headers.get('X-Session-Id') || body.sessionId;
  const { sessionId, session } = await loadAgenticSession(context.env, rawSid);

  const persona: AgentPersona =
    body.persona && VALID_PERSONAS.has(body.persona) ? body.persona : session.persona;

  const attackMode: AttackMode =
    body.attack_mode && VALID_ATTACK_MODES.has(body.attack_mode) ? body.attack_mode : 'NONE';

  const selectedOrderId =
    typeof body.order_id === 'string' && body.order_id.trim()
      ? body.order_id.trim()
      : session.selected_order_id;

  const capInfo = await checkAndIncrementDailyCap(context.env);
  const { bundle, telemetryEntry, httpStatus } = buildStage1ExchangeResult(
    session,
    persona,
    attackMode
  );

  const updatedSession = {
    ...session,
    persona,
    selected_order_id: selectedOrderId,
    token_bundle: bundle
  };

  const storage = await saveAgenticSession(context.env, sessionId, updatedSession);

  return jsonResponse(
    {
      status: bundle.status,
      http_status: httpStatus,
      expires_in: AGENTIC_STEP1_TTL_SECONDS,
      stripped_at_frontdoor: bundle.inbound_auth0_jwt.stripped_at_frontdoor,
      attack_mode: attackMode,
      error_code: bundle.error_code,
      error_detail: bundle.error_detail,
      token_bundle: bundle,
      telemetry_entry: telemetryEntry,
      session_id: sessionId,
      storage,
      kv_ttl_seconds: AGENTIC_SESSION_TTL_SECONDS,
      circuit_breaker: capInfo
    },
    httpStatus
  );
}
