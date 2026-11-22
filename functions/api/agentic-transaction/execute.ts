import {
  AGENTIC_SESSION_TTL_SECONDS,
  type AgenticTransactionEnv,
  buildStage2ExecuteResult,
  checkAndIncrementDailyCap,
  jsonResponse,
  loadAgenticSession,
  saveAgenticSession
} from './_shared';
import type { AgentPersona } from '../../../src/types';

type McpScenario = 'COMPLIANT_AUDIT' | 'RBAC_VIOLATION' | 'DLP_SECRET_LEAK' | 'LOW_VALUE_AUTO';

const VALID_SCENARIOS = new Set<McpScenario>([
  'COMPLIANT_AUDIT',
  'RBAC_VIOLATION',
  'DLP_SECRET_LEAK',
  'LOW_VALUE_AUTO'
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
    scenario?: McpScenario;
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

  const scenario: McpScenario =
    body.scenario && VALID_SCENARIOS.has(body.scenario) ? body.scenario : 'COMPLIANT_AUDIT';

  const orderId =
    typeof body.order_id === 'string' && body.order_id.trim()
      ? body.order_id.trim()
      : scenario === 'LOW_VALUE_AUTO'
        ? 'ORD-1049'
        : session.selected_order_id;

  const capInfo = await checkAndIncrementDailyCap(context.env);
  const { mcpResult, telemetryEntry, httpStatus } = buildStage2ExecuteResult(
    session,
    persona,
    orderId,
    scenario
  );

  const updatedSession = {
    ...session,
    persona,
    selected_order_id: orderId,
    mcp_result: mcpResult
  };

  const storage = await saveAgenticSession(context.env, sessionId, updatedSession);

  return jsonResponse(
    {
      status: mcpResult.overall_decision,
      http_status: httpStatus,
      scenario,
      order_id: orderId,
      persona,
      rbac_status: mcpResult.rbac_status,
      dlp_status: mcpResult.dlp_status,
      dlp_matched_rule: mcpResult.dlp_matched_rule,
      hitl_status: mcpResult.hitl_status,
      hitl_ticket_id: mcpResult.hitl_ticket_id,
      mcp_result: mcpResult,
      telemetry_entry: telemetryEntry,
      session_id: sessionId,
      storage,
      kv_ttl_seconds: AGENTIC_SESSION_TTL_SECONDS,
      circuit_breaker: capInfo
    },
    httpStatus
  );
}
