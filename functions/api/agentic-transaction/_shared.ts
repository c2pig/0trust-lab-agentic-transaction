import { CANONICAL_SEED_ERP_RECORDS, MCP_POLICY_CONTRACTS } from '../../../src/contracts/ecosystemContracts';
import type {
  AgentPersona,
  ErpExceptionRecord,
  ErpProcessStage,
  McpEvaluationResult,
  ServiceNowAuditEvent,
  SysAuditEntry,
  TelemetryLogEntry,
  TokenExchangeBundle
} from '../../../src/types';

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface AgenticTransactionEnv {
  STATE_KV?: KVNamespace;
  ENVIRONMENT?: string;
  SN_AGENT_CALLBACK_TOKEN?: string;
}

export function sanitizeSessionId(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return 'demo-visitor';
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'demo-visitor';
}

export const AGENTIC_SESSION_TTL_SECONDS = 3600; // 1h per-visitor STATE_KV isolation
export const AGENTIC_DAILY_CAP_TTL_SECONDS = 86400; // 24h circuit-breaker counter TTL
export const AGENTIC_DAILY_CAP_LIMIT = 100; // 100 calls/day cap
export const AGENTIC_STEP1_TTL_SECONDS = 900; // 15-minute (900s) scoped pass
export const DEFAULT_CALLBACK_SECRET = '0trust-sn-hitl-callback-token-v1';

export interface AgenticSessionRecord {
  session_id: string;
  correlation_id: string;
  traceparent: string;
  persona: AgentPersona;
  selected_order_id: string;
  token_bundle: TokenExchangeBundle | null;
  mcp_result: McpEvaluationResult | null;
  bedrock_sigv4_inspection: {
    endpoint: string;
    model_id: string;
    canonical_headers: Record<string, string>;
    authorization_header_masked: string;
    aws_request_id: string;
    advisory_summary: string;
    http_status: number;
  } | null;
  erp_records: ErpExceptionRecord[];
  sn_audit_events: ServiceNowAuditEvent[];
  sys_audit_log: SysAuditEntry[];
  hitl_callback_token?: string | null;
  updated_at: string;
}

const ephemeralAgenticSessionStore = new Map<string, { value: string; expiresAt: number }>();
const ephemeralAgenticCapStore = new Map<string, { value: string; expiresAt: number }>();
const MAX_EPHEMERAL_ENTRIES = 500;

function getEphemeral(
  store: Map<string, { value: string; expiresAt: number }>,
  key: string
): string | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function putEphemeral(
  store: Map<string, { value: string; expiresAt: number }>,
  key: string,
  value: string,
  ttlSeconds: number
): void {
  const now = Date.now();
  if (store.size >= MAX_EPHEMERAL_ENTRIES && !store.has(key)) {
    for (const [existingKey, existingEntry] of store) {
      if (now > existingEntry.expiresAt) {
        store.delete(existingKey);
      }
    }
    while (store.size >= MAX_EPHEMERAL_ENTRIES) {
      const oldestKey = store.keys().next().value;
      if (oldestKey === undefined) break;
      store.delete(oldestKey);
    }
  }
  store.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
}

export function agenticSessionKey(sessionId: string): string {
  return `lab2:agentic:${sanitizeSessionId(sessionId)}`;
}

export function agenticDailyCapKey(now: Date = new Date()): string {
  const utcDate = now.toISOString().slice(0, 10);
  return `lab2:cap:${utcDate}`;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

export function generateCallbackToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

export function toBase64UrlString(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function getSourceTableForProcess(process: ErpProcessStage): string {
  switch (process) {
    case 'credit':
      return 'x_ent_erp_ovl_credit_exception';
    case 'order':
      return 'x_ent_erp_ovl_order_exception';
    case 'fulfillment':
      return 'x_ent_erp_ovl_fulfillment_exception';
    case 'invoice':
      return 'x_ent_erp_ovl_invoice_exception';
    case 'cash':
      return 'x_ent_erp_ovl_cash_exception';
  }
}

export function createInitialAgenticSession(sessionId: string): AgenticSessionRecord {
  const nowIso = new Date().toISOString();
  return {
    session_id: sessionId,
    correlation_id: 'corr_89b4f1a2_ord1042',
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    persona: 'erp-operator',
    selected_order_id: 'ORD-1042',
    token_bundle: null,
    mcp_result: null,
    bedrock_sigv4_inspection: null,
    erp_records: CANONICAL_SEED_ERP_RECORDS.map((r) => ({ ...r })),
    sn_audit_events: [],
    sys_audit_log: [
      {
        sys_id: 'sys_aud_seed_0001',
        timestamp: '2026-11-17T08:15:00Z',
        tablename: 'x_ent_erp_ovl_credit_exception',
        documentkey: '8f2a9c41d7102200a9ad1e173e24d401',
        fieldname: 'current_status',
        oldvalue: 'NEW',
        newvalue: 'BLOCKED',
        user: 'system.sap_ecc_sync'
      }
    ],
    hitl_callback_token: null,
    updated_at: nowIso
  };
}

export async function loadAgenticSession(
  env: AgenticTransactionEnv,
  rawSessionId?: string | null
): Promise<{
  sessionId: string;
  session: AgenticSessionRecord;
  storage: 'cloudflare-kv' | 'ephemeral-edge';
}> {
  const sessionId = sanitizeSessionId(rawSessionId);
  const key = agenticSessionKey(sessionId);
  const raw = env.STATE_KV
    ? await env.STATE_KV.get(key)
    : getEphemeral(ephemeralAgenticSessionStore, key);

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as AgenticSessionRecord;
      if (parsed && Array.isArray(parsed.erp_records)) {
        return {
          sessionId,
          session: parsed,
          storage: env.STATE_KV ? 'cloudflare-kv' : 'ephemeral-edge'
        };
      }
    } catch {
      // Fall through to seed a fresh session record
    }
  }

  return {
    sessionId,
    session: createInitialAgenticSession(sessionId),
    storage: env.STATE_KV ? 'cloudflare-kv' : 'ephemeral-edge'
  };
}

export async function saveAgenticSession(
  env: AgenticTransactionEnv,
  sessionId: string,
  session: AgenticSessionRecord
): Promise<'cloudflare-kv' | 'ephemeral-edge'> {
  const cleanSid = sanitizeSessionId(sessionId);
  const key = agenticSessionKey(cleanSid);
  const payload = JSON.stringify({
    ...session,
    session_id: cleanSid,
    updated_at: new Date().toISOString()
  });

  if (env.STATE_KV) {
    await env.STATE_KV.put(key, payload, {
      expirationTtl: AGENTIC_SESSION_TTL_SECONDS
    });
    return 'cloudflare-kv';
  }

  putEphemeral(ephemeralAgenticSessionStore, key, payload, AGENTIC_SESSION_TTL_SECONDS);
  return 'ephemeral-edge';
}

export async function checkAndIncrementDailyCap(
  env: AgenticTransactionEnv
): Promise<{
  count: number;
  limit: number;
  cap_reached: boolean;
  execution_mode: 'edge-sandbox' | 'edge-cap-fallback';
}> {
  const key = agenticDailyCapKey();
  const raw = env.STATE_KV
    ? await env.STATE_KV.get(key)
    : getEphemeral(ephemeralAgenticCapStore, key);

  const currentCount = raw ? Number.parseInt(raw, 10) || 0 : 0;
  const nextCount = currentCount + 1;
  const capReached = nextCount > AGENTIC_DAILY_CAP_LIMIT;

  if (env.STATE_KV) {
    await env.STATE_KV.put(key, String(nextCount), {
      expirationTtl: AGENTIC_DAILY_CAP_TTL_SECONDS
    });
  } else {
    putEphemeral(ephemeralAgenticCapStore, key, String(nextCount), AGENTIC_DAILY_CAP_TTL_SECONDS);
  }

  return {
    count: nextCount,
    limit: AGENTIC_DAILY_CAP_LIMIT,
    cap_reached: capReached,
    execution_mode: capReached ? 'edge-cap-fallback' : 'edge-sandbox'
  };
}

export function buildStage1ExchangeResult(
  session: AgenticSessionRecord,
  persona: AgentPersona,
  attackMode: 'NONE' | 'RAW_JWT_FORWARD' | 'ID_JAG_WRONG_AUD' | 'SPOOF_GCP_SA'
): {
  bundle: TokenExchangeBundle;
  telemetryEntry: TelemetryLogEntry;
  httpStatus: number;
} {
  const nowIso = new Date().toISOString();
  const iatEpoch = Math.floor(Date.now() / 1000);
  const expEpoch = iatEpoch + AGENTIC_STEP1_TTL_SECONDS; // 900s (15-minute) scoped pass

  const auth0Header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: 'auth0-frontdoor-key-2026'
  };
  const auth0Payload = {
    iss: 'https://login.0trust.dev/',
    sub: 'auth0|673a91c88f12e0019b4c2d10',
    email: 'sarah.chen@0trust.dev',
    persona,
    aud: 'https://frontdoor-run.0trust.dev',
    iat: iatEpoch,
    exp: expEpoch
  };

  const jagHeader = {
    alg: 'RS256',
    typ: 'oauth-id-jag+jwt',
    kid: 'okta-id-jag-signing-key-01'
  };
  const jagPayload = {
    iss: 'https://0trust.okta.com',
    sub: 'sarah.chen@0trust.dev',
    aud:
      attackMode === 'ID_JAG_WRONG_AUD'
        ? 'https://malicious-unrelated-service.internal/oauth/token'
        : 'https://vertex-agent.0trust.dev/oauth/token',
    client_id: 'erp-ai-copilot',
    scope: 'mcp:tools:call erp:credit:audit',
    act: {
      sub: 'spiffe://0trust.dev/ns/prod/sa/cloud-run-frontdoor'
    },
    jti: `jag_${session.correlation_id}`,
    iat: iatEpoch,
    exp: expEpoch,
    expires_in: AGENTIC_STEP1_TTL_SECONDS
  };

  const rawJagJwt = `${toBase64UrlString(JSON.stringify(jagHeader))}.${toBase64UrlString(
    JSON.stringify(jagPayload)
  )}.c2lnbmF0dXJlX3ZlcmlmaWVkX2J5X29rdGFfandrc19yc2EyNTZfOTk4ODc3NjY`;

  const gcpServiceAccount =
    attackMode === 'SPOOF_GCP_SA'
      ? 'rogue-untrusted-workload@shadow-proj-999.iam.gserviceaccount.com'
      : 'vertex-agent-sa@zero-trust-prod.iam.gserviceaccount.com';

  const gcpSubUniqueId =
    attackMode === 'SPOOF_GCP_SA'
      ? '109999999999999999999'
      : '114829401928374650192';

  const gcpOidcPayload = {
    iss: 'https://accounts.google.com',
    sub: gcpSubUniqueId,
    email: gcpServiceAccount,
    email_verified: true,
    aud: 'sts.amazonaws.com://904233108812/cross-cloud-agentcore-obo-role',
    azp: gcpSubUniqueId,
    iat: iatEpoch,
    exp: expEpoch
  };

  const isAttack = attackMode !== 'NONE';
  let errorCode: string | undefined;
  let errorDetail: string | undefined;
  let attackTelemetryTitle = '';
  let blockedInvariant = '';

  if (attackMode === 'RAW_JWT_FORWARD') {
    errorCode = 'ERR_CONFUSED_DEPUTY_RAW_BEARER_REJECTED';
    errorDetail =
      'Cloud Run Frontdoor stripped inbound user JWT; Vertex AI Agent Engine rejected raw user bearer token forwarding. RFC 8693 ID-JAG token exchange is mandatory.';
    attackTelemetryTitle =
      'Confused Deputy Blocked: Raw Inbound Bearer Token Forwarding Rejected';
    blockedInvariant =
      'Invariant: Inbound user Authorization header is stripped at Cloud Run Frontdoor (stripped_at_frontdoor: true) and never forwarded downstream.';
  } else if (attackMode === 'ID_JAG_WRONG_AUD') {
    errorCode = 'ERR_ID_JAG_AUDIENCE_MISMATCH';
    errorDetail =
      'Okta oauth-id-jag+jwt assertion rejected: audience claim "https://malicious-unrelated-service.internal/oauth/token" failed strict equality check against "https://vertex-agent.0trust.dev/oauth/token".';
    attackTelemetryTitle =
      'Confused Deputy Blocked: Okta ID-JAG Audience Claim Mismatch';
    blockedInvariant =
      'Invariant: RFC 8693 Token Exchange enforces strict audience binding (aud == https://vertex-agent.0trust.dev/oauth/token).';
  } else if (attackMode === 'SPOOF_GCP_SA') {
    errorCode = 'ERR_AWS_STS_OIDC_SUB_MISMATCH';
    errorDetail =
      'AWS STS AssumeRoleWithWebIdentity AccessDenied: Condition StringEquals on accounts.google.com:sub failed for spoofed service account unique ID 109999999999999999999.';
    attackTelemetryTitle =
      'Cross-Cloud Federation Blocked: Spoofed GCP Service Account Denied by AWS STS';
    blockedInvariant =
      'Invariant: AWS IAM Trust Policy enforces StringEquals on accounts.google.com:sub and accounts.google.com:aud.';
  }

  const bundle: TokenExchangeBundle = {
    correlation_id: session.correlation_id,
    traceparent: session.traceparent,
    user_email: 'sarah.chen@0trust.dev',
    persona,
    inbound_auth0_jwt: {
      header: auth0Header,
      payload: auth0Payload,
      raw_token_preview: `${toBase64UrlString(JSON.stringify(auth0Header))}.${toBase64UrlString(
        JSON.stringify(auth0Payload)
      ).slice(0, 48)}...`,
      stripped_at_frontdoor: attackMode !== 'RAW_JWT_FORWARD'
    },
    okta_id_jag_jwt: {
      header: jagHeader,
      payload: jagPayload,
      raw_jwt: rawJagJwt,
      sha256_fingerprint:
        'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
    },
    gcp_oidc_token: {
      service_account: gcpServiceAccount,
      audience: 'sts.amazonaws.com://904233108812/cross-cloud-agentcore-obo-role',
      payload: gcpOidcPayload
    },
    aws_sts_session: {
      assumed_role_arn:
        'arn:aws:sts::904233108812:assumed-role/cross-cloud-agentcore-obo-role/obo-sarah-chen',
      session_name: 'obo-sarah-chen',
      access_key_id: isAttack ? 'DENIED_NO_STS_CREDENTIALS' : 'ASIA5F2K9X8MEXAMPLE',
      expiration: new Date(expEpoch * 1000).toISOString(),
      invariants_verified: isAttack
        ? [blockedInvariant]
        : [
            'Inbound Auth0 user JWT stripped at Cloud Run Frontdoor after signature verification (stripped_at_frontdoor: true)',
            'Okta RFC 8693 oauth-id-jag+jwt minted with 900s (15m) TTL and aud=https://vertex-agent.0trust.dev/oauth/token',
            'GCP Vertex AI workload OIDC token verified by AWS IAM OIDC provider (accounts.google.com)',
            'AWS STS AssumeRoleWithWebIdentity issued 15m (900s) ephemeral session obo-sarah-chen'
          ]
    },
    status: isAttack ? 'ATTACK_BLOCKED' : 'VALIDATED',
    error_code: errorCode,
    error_detail: errorDetail
  };

  const telemetryEntry: TelemetryLogEntry = isAttack
    ? {
        id: `tel_s1_err_${Date.now()}`,
        timestamp: nowIso,
        stage: 1,
        layer: attackMode === 'SPOOF_GCP_SA' ? 'GCP_AWS_OBO' : 'OKTA_ID_JAG',
        severity: 'CRITICAL',
        title: attackTelemetryTitle,
        correlation_id: session.correlation_id,
        traceparent: session.traceparent,
        payload: {
          attack_mode: attackMode,
          stripped_at_frontdoor: bundle.inbound_auth0_jwt.stripped_at_frontdoor,
          expires_in: AGENTIC_STEP1_TTL_SECONDS,
          error_code: errorCode,
          error_detail: errorDetail,
          blocked_invariant: blockedInvariant
        }
      }
    : {
        id: `tel_s1_ok_${Date.now()}`,
        timestamp: nowIso,
        stage: 1,
        layer: 'GCP_AWS_OBO',
        severity: 'SUCCESS',
        title:
          'Stage 1 Validated: Okta ID-JAG (900s) Minted & GCP→AWS STS AssumeRoleWithWebIdentity Assumed',
        correlation_id: session.correlation_id,
        traceparent: session.traceparent,
        payload: {
          stripped_at_frontdoor: true,
          expires_in: AGENTIC_STEP1_TTL_SECONDS,
          okta_sub: 'sarah.chen@0trust.dev',
          okta_aud: 'https://vertex-agent.0trust.dev/oauth/token',
          gcp_sa: gcpServiceAccount,
          aws_assumed_role:
            'arn:aws:sts::904233108812:assumed-role/cross-cloud-agentcore-obo-role/obo-sarah-chen'
        }
      };

  return {
    bundle,
    telemetryEntry,
    httpStatus: isAttack ? 403 : 200
  };
}

export function buildStage2ExecuteResult(
  session: AgenticSessionRecord,
  persona: AgentPersona,
  orderId: string,
  scenario: 'COMPLIANT_AUDIT' | 'RBAC_VIOLATION' | 'DLP_SECRET_LEAK' | 'LOW_VALUE_AUTO'
): {
  mcpResult: McpEvaluationResult;
  telemetryEntry: TelemetryLogEntry;
  httpStatus: number;
} {
  const nowIso = new Date().toISOString();
  const selectedRecord =
    session.erp_records.find((r) => r.order_id === orderId) ||
    session.erp_records[0];

  let toolName = 'audit_and_release_credit_hold';
  let activePersona = persona;
  let toolArgs: Record<string, unknown> = {
    order_id: selectedRecord.order_id,
    customer_id: selectedRecord.customer_id,
    amount: selectedRecord.amount_usd,
    currency: 'USD',
    reason: 'Automated credit hold release request via ERP Copilot'
  };

  let rbacStatus: 'PASS' | 'DENY' = 'PASS';
  let dlpStatus: 'PASS' | 'BLOCK' = 'PASS';
  let dlpMatchedRule: string | undefined;
  let hitlStatus: 'AUTO_APPROVED' | 'PENDING_HUMAN_APPROVAL' | 'N/A' = 'N/A';
  let hitlTicketId: string | undefined;
  let overallDecision: McpEvaluationResult['overall_decision'] = 'ALLOWED';
  let jsonrpcResponse: Record<string, unknown> = {};
  let telemetrySeverity: TelemetryLogEntry['severity'] = 'SUCCESS';
  let telemetryTitle = '';
  let httpStatus = 200;

  if (scenario === 'COMPLIANT_AUDIT') {
    toolName = 'audit_and_release_credit_hold';
    const rolePolicy = MCP_POLICY_CONTRACTS.toolAllowlist.roles[activePersona];
    const isAllowed = rolePolicy.allowedTools.includes(toolName);

    if (!isAllowed) {
      rbacStatus = 'DENY';
      dlpStatus = 'PASS';
      hitlStatus = 'N/A';
      overallDecision = 'DENIED_RBAC';
      telemetrySeverity = 'CRITICAL';
      telemetryTitle = `MCP RBAC Denied (-32001): Persona '${activePersona}' unauthorized for '${toolName}'`;
      httpStatus = 403;
      jsonrpcResponse = {
        jsonrpc: '2.0',
        id: 'req_mcp_2041',
        error: {
          code: -32001,
          message: 'ToolExecutionDenied',
          data: {
            policy: MCP_POLICY_CONTRACTS.toolAllowlist.policyName,
            persona: activePersona,
            tool: toolName,
            reason: `Only 'erp-operator' is authorized to invoke '${toolName}'.`
          }
        }
      };
    } else {
      rbacStatus = 'PASS';
      dlpStatus = 'PASS';
      if (selectedRecord.amount_usd > 200) {
        hitlStatus = 'PENDING_HUMAN_APPROVAL';
        hitlTicketId = `HITL-SN-${selectedRecord.order_id.replace('ORD-', '')}`;
        overallDecision = 'ESCALATED_HITL';
        telemetrySeverity = 'WARN';
        telemetryTitle = `MCP HITL Escalated (HITL-001): ${selectedRecord.order_id} ($${selectedRecord.amount_usd.toLocaleString()}) > $200.00 Threshold`;
        httpStatus = 202;
        jsonrpcResponse = {
          jsonrpc: '2.0',
          id: 'req_mcp_2041',
          result: {
            status: 'PENDING_HUMAN_APPROVAL',
            hitl_rule_id: 'HITL-001',
            hitl_ticket_id: hitlTicketId,
            escalation_channel: 'servicenow-approval-queue',
            approver_role: 'finance-manager',
            message: `Transaction amount $${selectedRecord.amount_usd.toLocaleString()} exceeds $200.00 autonomous limit. Routed to ServiceNow x_ent_erp_ovl for Bedrock advisory & human controller release.`
          }
        };
      } else {
        hitlStatus = 'AUTO_APPROVED';
        overallDecision = 'ALLOWED';
        telemetrySeverity = 'SUCCESS';
        telemetryTitle = `MCP Policy Allowed: ${selectedRecord.order_id} ($${selectedRecord.amount_usd}) <= $200.00 Threshold`;
        httpStatus = 200;
        jsonrpcResponse = {
          jsonrpc: '2.0',
          id: 'req_mcp_2041',
          result: {
            status: 'AUTO_APPROVED',
            order_id: selectedRecord.order_id,
            amount_usd: selectedRecord.amount_usd
          }
        };
      }
    }
  } else if (scenario === 'RBAC_VIOLATION') {
    activePersona = 'support-agent';
    toolName = 'execute_erp_refund';
    toolArgs = {
      order_id: selectedRecord.order_id,
      amount: selectedRecord.amount_usd,
      destination_iban: 'DE89370400440532013000'
    };
    rbacStatus = 'DENY';
    dlpStatus = 'PASS';
    hitlStatus = 'N/A';
    overallDecision = 'DENIED_RBAC';
    telemetrySeverity = 'CRITICAL';
    telemetryTitle =
      "MCP RBAC Denied (-32001): Persona 'support-agent' blocked from 'execute_erp_refund'";
    httpStatus = 403;
    jsonrpcResponse = {
      jsonrpc: '2.0',
      id: 'req_mcp_2042',
      error: {
        code: -32001,
        message: 'ToolExecutionDenied',
        data: {
          policy: 'agent-tool-rbac',
          persona: 'support-agent',
          tool: 'execute_erp_refund',
          allowed_tools:
            MCP_POLICY_CONTRACTS.toolAllowlist.roles['support-agent'].allowedTools
        }
      }
    };
  } else if (scenario === 'DLP_SECRET_LEAK') {
    toolName = 'create_service_ticket';
    toolArgs = {
      order_id: selectedRecord.order_id,
      customer_ssn: '123-45-6789',
      bearer_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.secret_api_key_99887766',
      note: 'Diagnostic dump attached by agent'
    };
    rbacStatus = 'PASS';
    dlpStatus = 'BLOCK';
    dlpMatchedRule = 'DLP-003 (API Bearer Token / Secret Key) & DLP-002 (SSN 123-45-6789)';
    hitlStatus = 'N/A';
    overallDecision = 'DENIED_DLP';
    telemetrySeverity = 'CRITICAL';
    telemetryTitle =
      'MCP DLP Interceptor Blocked (-32002): Raw Bearer Token & SSN Detected in Tool Arguments';
    httpStatus = 403;
    jsonrpcResponse = {
      jsonrpc: '2.0',
      id: 'req_mcp_2043',
      error: {
        code: -32002,
        message: 'DLPViolationDetected',
        data: {
          policy: 'agent-dlp-rules',
          matched_rules: ['DLP-003', 'DLP-002'],
          action: 'BLOCK',
          detail: 'Outbound execution blocked: raw credentials and SSN detected in payload'
        }
      }
    };
  } else if (scenario === 'LOW_VALUE_AUTO') {
    activePersona = 'erp-operator';
    toolName = 'issue_privileged_refund';
    toolArgs = {
      order_id: 'ORD-1049',
      customer_id: 'CUST-NOVA-019',
      amount: 180.0,
      currency: 'USD',
      reason: 'Freight tax adjustment within $200 autonomous threshold'
    };
    rbacStatus = 'PASS';
    dlpStatus = 'PASS';
    hitlStatus = 'AUTO_APPROVED';
    overallDecision = 'ALLOWED';
    telemetrySeverity = 'SUCCESS';
    telemetryTitle =
      'MCP Auto-Approved (HITL-001): ORD-1049 Refund ($180.00 <= $200.00 Threshold)';
    httpStatus = 200;
    jsonrpcResponse = {
      jsonrpc: '2.0',
      id: 'req_mcp_2044',
      result: {
        status: 'AUTO_APPROVED',
        tool: 'issue_privileged_refund',
        order_id: 'ORD-1049',
        amount_usd: 180.0,
        hitl_evaluated: 'amount (180.00) <= 200.00 -> AUTO_APPROVED'
      }
    };
  }

  const mcpResult: McpEvaluationResult = {
    correlation_id: session.correlation_id,
    traceparent: session.traceparent,
    jsonrpc_request: {
      jsonrpc: '2.0',
      id: 'req_mcp_2041',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: toolArgs,
        _meta: {
          persona: activePersona,
          correlation_id: session.correlation_id,
          traceparent: session.traceparent
        }
      }
    },
    jsonrpc_response: jsonrpcResponse,
    rbac_status: rbacStatus,
    dlp_status: dlpStatus,
    dlp_matched_rule: dlpMatchedRule,
    hitl_status: hitlStatus,
    hitl_ticket_id: hitlTicketId,
    overall_decision: overallDecision
  };

  const telemetryEntry: TelemetryLogEntry = {
    id: `tel_s2_${Date.now()}`,
    timestamp: nowIso,
    stage: 2,
    layer: 'MCP_GOVERNANCE',
    severity: telemetrySeverity,
    title: telemetryTitle,
    correlation_id: session.correlation_id,
    traceparent: session.traceparent,
    payload: {
      scenario,
      persona: activePersona,
      tool: toolName,
      rbac_status: rbacStatus,
      dlp_status: dlpStatus,
      hitl_status: hitlStatus,
      overall_decision: overallDecision
    }
  };

  return {
    mcpResult,
    telemetryEntry,
    httpStatus
  };
}
