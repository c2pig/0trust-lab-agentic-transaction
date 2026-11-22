import {
  CANONICAL_SEED_ERP_RECORDS,
  MCP_POLICY_CONTRACTS
} from '../contracts/ecosystemContracts';
import {
  ErpProcessStage,
  McpEvaluationResult,
  PlaygroundState,
  ServiceNowAuditEvent,
  SysAuditEntry,
  TelemetryLogEntry,
  TokenExchangeBundle
} from '../types';

const STORAGE_KEY = '0trust_agentic_tx_state_v1';

function toBase64Url(input: string): string {
  const base64 =
    typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(input)))
      : input;
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function computeWeeklyResetWindow(now: Date = new Date()): {
  lastResetUtc: string;
  nextResetUtc: string;
} {
  const utcDay = now.getUTCDay(); // 0 = Sunday
  const lastSunday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - utcDay,
      0,
      0,
      0,
      0
    )
  );
  const nextSunday = new Date(lastSunday.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    lastResetUtc: lastSunday.toISOString(),
    nextResetUtc: nextSunday.toISOString()
  };
}

function getSourceTableForProcess(process: ErpProcessStage): string {
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

export function savePlaygroundState(state: PlaygroundState): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function resetToCanonicalSeed(
  reason: 'MANUAL_RESET' | 'WEEKLY_CRON_RESET' = 'MANUAL_RESET'
): PlaygroundState {
  const now = new Date();
  const nowIso = now.toISOString();
  const { lastResetUtc, nextResetUtc } = computeWeeklyResetWindow(now);
  const correlationId = 'corr_89b4f1a2_ord1042';
  const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

  const seededRecords = CANONICAL_SEED_ERP_RECORDS.map((record) => ({
    ...record
  }));

  const initialTelemetry: TelemetryLogEntry = {
    id: `tel_reset_${now.getTime()}`,
    timestamp: nowIso,
    stage: 1,
    layer: 'STATE_RESET',
    severity: 'INFO',
    title:
      reason === 'WEEKLY_CRON_RESET'
        ? 'Sandbox Weekly Reset Complete — Ready for Step 1'
        : 'Interactive Sandbox Ready — Run Step 1 or Launch an Attack',
    correlation_id: correlationId,
    traceparent,
    payload: {
      reset_reason: reason,
      last_weekly_reset_utc: reason === 'WEEKLY_CRON_RESET' ? nowIso : lastResetUtc,
      next_weekly_reset_utc: nextResetUtc,
      seeded_erp_exceptions: seededRecords.length,
      primary_showcase_order: 'ORD-1042 ($145,000 BLOCKED)'
    }
  };

  const initialSysAudit: SysAuditEntry = {
    sys_id: 'sys_aud_seed_0001',
    timestamp: '2026-11-17T08:15:00Z',
    tablename: 'x_ent_erp_ovl_credit_exception',
    documentkey: '8f2a9c41d7102200a9ad1e173e24d401',
    fieldname: 'current_status',
    oldvalue: 'NEW',
    newvalue: 'BLOCKED',
    user: 'system.sap_ecc_sync'
  };

  const state: PlaygroundState = {
    initialized_at: nowIso,
    last_weekly_reset_utc: reason === 'WEEKLY_CRON_RESET' ? nowIso : lastResetUtc,
    next_weekly_reset_utc: nextResetUtc,
    mode: 'sandbox',
    active_stage: 1,
    persona: 'erp-operator',
    selected_order_id: 'ORD-1042',
    active_erp_tab: 'credit',
    correlation_id: correlationId,
    traceparent,
    token_bundle: null,
    mcp_result: null,
    bedrock_sigv4_inspection: null,
    erp_records: seededRecords,
    sn_audit_events: [],
    sys_audit_log: [initialSysAudit],
    telemetry_stream: [initialTelemetry]
  };

  savePlaygroundState(state);
  return state;
}

export function loadPlaygroundState(): PlaygroundState {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PlaygroundState;
        if (parsed && parsed.next_weekly_reset_utc) {
          const nextResetMs = Date.parse(parsed.next_weekly_reset_utc);
          if (!Number.isNaN(nextResetMs) && Date.now() >= nextResetMs) {
            return resetToCanonicalSeed('WEEKLY_CRON_RESET');
          }
          return parsed;
        }
      }
    }
  } catch {
    // Fall back to fresh canonical seed
  }
  return resetToCanonicalSeed('MANUAL_RESET');
}

export function executeStage1TokenExchange(
  state: PlaygroundState,
  attackMode: 'NONE' | 'RAW_JWT_FORWARD' | 'ID_JAG_WRONG_AUD' | 'SPOOF_GCP_SA' = 'NONE'
): PlaygroundState {
  const nowIso = new Date().toISOString();
  const expEpoch = Math.floor(Date.now() / 1000) + 900; // 15-minute short-lived token
  const iatEpoch = Math.floor(Date.now() / 1000);

  const auth0Header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: 'auth0-frontdoor-key-2026'
  };
  const auth0Payload = {
    iss: 'https://login.0trust.dev/',
    sub: 'auth0|673a91c88f12e0019b4c2d10',
    email: 'sarah.chen@0trust.dev',
    persona: state.persona,
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
    jti: `jag_${state.correlation_id}`,
    iat: iatEpoch,
    exp: expEpoch,
    expires_in: 900
  };

  const rawJagJwt = `${toBase64Url(JSON.stringify(jagHeader))}.${toBase64Url(
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
      'Invariant: Inbound user Authorization header is stripped at Cloud Run Frontdoor and never forwarded downstream.';
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
    correlation_id: state.correlation_id,
    traceparent: state.traceparent,
    user_email: 'sarah.chen@0trust.dev',
    persona: state.persona,
    inbound_auth0_jwt: {
      header: auth0Header,
      payload: auth0Payload,
      raw_token_preview: `${toBase64Url(JSON.stringify(auth0Header))}.${toBase64Url(
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
        correlation_id: state.correlation_id,
        traceparent: state.traceparent,
        payload: {
          attack_mode: attackMode,
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
          'Stage 1 Validated: Okta ID-JAG Minted & GCP→AWS STS AssumeRoleWithWebIdentity Assumed',
        correlation_id: state.correlation_id,
        traceparent: state.traceparent,
        payload: {
          okta_sub: 'sarah.chen@0trust.dev',
          okta_aud: 'https://vertex-agent.0trust.dev/oauth/token',
          gcp_sa: gcpServiceAccount,
          aws_assumed_role:
            'arn:aws:sts::904233108812:assumed-role/cross-cloud-agentcore-obo-role/obo-sarah-chen'
        }
      };

  const nextState: PlaygroundState = {
    ...state,
    token_bundle: bundle,
    telemetry_stream: [telemetryEntry, ...state.telemetry_stream]
  };

  savePlaygroundState(nextState);
  return nextState;
}

export function executeStage2McpPolicy(
  state: PlaygroundState,
  scenario: 'COMPLIANT_AUDIT' | 'RBAC_VIOLATION' | 'DLP_SECRET_LEAK' | 'LOW_VALUE_AUTO'
): PlaygroundState {
  const nowIso = new Date().toISOString();
  const selectedRecord =
    state.erp_records.find((r) => r.order_id === state.selected_order_id) ||
    state.erp_records[0];

  let toolName = 'audit_and_release_credit_hold';
  let activePersona = state.persona;
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
    correlation_id: state.correlation_id,
    traceparent: state.traceparent,
    jsonrpc_request: {
      jsonrpc: '2.0',
      id: 'req_mcp_2041',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: toolArgs,
        _meta: {
          persona: activePersona,
          correlation_id: state.correlation_id,
          traceparent: state.traceparent
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
    correlation_id: state.correlation_id,
    traceparent: state.traceparent,
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

  const nextState: PlaygroundState = {
    ...state,
    mcp_result: mcpResult,
    telemetry_stream: [telemetryEntry, ...state.telemetry_stream]
  };

  savePlaygroundState(nextState);
  return nextState;
}

export function executeStage3BedrockAudit(
  state: PlaygroundState,
  orderId: string,
  simulateTimeout: boolean = false
): PlaygroundState {
  const now = new Date();
  const nowIso = now.toISOString();
  const amzDate = nowIso.replace(/[:-]|\.\d{3}/g, '');
  const awsRequestId = 'req_bedrock_8841a9c2';

  const targetRecord =
    state.erp_records.find((r) => r.order_id === orderId) || state.erp_records[0];
  const sourceTable = getSourceTableForProcess(targetRecord.process);

  const canonicalHeaders: Record<string, string> = {
    host: 'bedrock-runtime.us-east-1.amazonaws.com',
    'content-type': 'application/json',
    'x-amz-date': amzDate,
    'x-amz-content-sha256':
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'x-amz-security-token': 'FwoGZXIvYXdzEBYaDH8f9c4e81d02a6b5f...[REDACTED_STS_SESSION_TOKEN]'
  };

  const authorizationHeaderMasked =
    'AWS4-HMAC-SHA256 Credential=ASIA5F2K.../us-east-1/bedrock/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=7f9c4e...';

  const buttonEvent: ServiceNowAuditEvent = {
    event_id: `sn_evt_btn_${now.getTime()}`,
    timestamp: nowIso,
    process: targetRecord.process,
    order_id: targetRecord.order_id,
    source_table: sourceTable,
    event_type: 'BUTTON',
    correlation_id: state.correlation_id,
    aws_request_id: awsRequestId,
    http_status: 202,
    decision: 'PROCESSING',
    actor: 'sarah.chen@0trust.dev (Workspace UI Action)',
    note: `Operator clicked "Run Agentic Audit" on ${targetRecord.order_id}. Flow transitioned record BLOCKED -> PROCESSING.`
  };

  const sysAuditToProcessing: SysAuditEntry = {
    sys_id: `sys_aud_proc_${now.getTime()}`,
    timestamp: nowIso,
    tablename: sourceTable,
    documentkey: targetRecord.sys_id,
    fieldname: 'current_status',
    oldvalue: targetRecord.current_status,
    newvalue: 'PROCESSING',
    user: 'sarah.chen@0trust.dev'
  };

  if (simulateTimeout) {
    const timeoutJustification = `${targetRecord.ai_justification}\n\n[WARN ${nowIso}] Outbound AWS Bedrock invocation (${awsRequestId}) timed out after 10,000ms (HTTP 504 Gateway Timeout). Fail-safe Rollback Invariant triggered: current_status reverted from PROCESSING to BLOCKED.`;

    const bedrockTimeoutEvent: ServiceNowAuditEvent = {
      event_id: `sn_evt_bdk_timeout_${now.getTime() + 1}`,
      timestamp: nowIso,
      process: targetRecord.process,
      order_id: targetRecord.order_id,
      source_table: sourceTable,
      event_type: 'BEDROCK_RESULT',
      correlation_id: state.correlation_id,
      aws_request_id: awsRequestId,
      http_status: 504,
      decision: 'REVERTED_TO_BLOCKED',
      actor: 'system.aws_bedrock_flow',
      note: 'Bedrock endpoint HTTP 504 timeout; record safely reverted to BLOCKED.'
    };

    const sysAuditRevert: SysAuditEntry = {
      sys_id: `sys_aud_rev_${now.getTime() + 1}`,
      timestamp: nowIso,
      tablename: sourceTable,
      documentkey: targetRecord.sys_id,
      fieldname: 'current_status',
      oldvalue: 'PROCESSING',
      newvalue: 'BLOCKED',
      user: 'system.aws_bedrock_flow'
    };

    const updatedRecords = state.erp_records.map((rec) =>
      rec.order_id === targetRecord.order_id
        ? {
            ...rec,
            current_status: 'BLOCKED' as const,
            correlation_id: state.correlation_id,
            aws_request_id: awsRequestId,
            ai_justification: timeoutJustification,
            updated_at: nowIso,
            updated_by: 'system.aws_bedrock_flow'
          }
        : rec
    );

    const telemetryTimeout: TelemetryLogEntry = {
      id: `tel_s3_timeout_${now.getTime()}`,
      timestamp: nowIso,
      stage: 3,
      layer: 'SERVICENOW_BEDROCK',
      severity: 'WARN',
      title: `Bedrock SigV4 Timeout (HTTP 504) on ${targetRecord.order_id} — Record Reverted to BLOCKED`,
      correlation_id: state.correlation_id,
      traceparent: state.traceparent,
      aws_request_id: awsRequestId,
      payload: {
        order_id: targetRecord.order_id,
        http_status: 504,
        status_transition: 'BLOCKED -> PROCESSING -> BLOCKED',
        aws_request_id: awsRequestId
      }
    };

    const nextState: PlaygroundState = {
      ...state,
      selected_order_id: targetRecord.order_id,
      active_erp_tab: targetRecord.process,
      bedrock_sigv4_inspection: {
        endpoint:
          'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet-20241022-v2:0/invoke',
        model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        canonical_headers: canonicalHeaders,
        authorization_header_masked: authorizationHeaderMasked,
        aws_request_id: awsRequestId,
        advisory_summary:
          'HTTP 504 Gateway Timeout from AWS Bedrock runtime. Record automatically reverted to BLOCKED.',
        http_status: 504
      },
      erp_records: updatedRecords,
      sn_audit_events: [bedrockTimeoutEvent, buttonEvent, ...state.sn_audit_events],
      sys_audit_log: [sysAuditRevert, sysAuditToProcessing, ...state.sys_audit_log],
      telemetry_stream: [telemetryTimeout, ...state.telemetry_stream]
    };

    savePlaygroundState(nextState);
    return nextState;
  }

  const pastDueSummary =
    targetRecord.days_past_due > 0
      ? `Current ${targetRecord.days_past_due}-day past-due status on ${targetRecord.current_exposure_usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} exposure is tied to a pending settlement in transit.`
      : `Account exposure ($${targetRecord.current_exposure_usd.toLocaleString()}) is within credit limits ($${targetRecord.credit_limit_usd.toLocaleString()}).`;

  const advisoryText = `[Bedrock Claude 3.5 Sonnet Advisory | ${awsRequestId}]: Customer ${targetRecord.customer_name} (${targetRecord.customer_id}) carries 99.4% historical on-time settlement over 36 months. ${pastDueSummary} Recommend CONDITIONAL CREDIT RELEASE for ${targetRecord.order_id} ($${targetRecord.amount_usd.toLocaleString()}) subject to mandatory Human Manager sign-off. (AI cannot release funds autonomously).`;

  const bedrockSuccessEvent: ServiceNowAuditEvent = {
    event_id: `sn_evt_bdk_ok_${now.getTime() + 1}`,
    timestamp: nowIso,
    process: targetRecord.process,
    order_id: targetRecord.order_id,
    source_table: sourceTable,
    event_type: 'BEDROCK_RESULT',
    correlation_id: state.correlation_id,
    aws_request_id: awsRequestId,
    http_status: 200,
    decision: 'ADVISORY_APPENDED_AWAITING_HITL',
    actor: 'system.aws_bedrock_flow',
    note: 'SigV4 Bedrock invocation succeeded (HTTP 200). AI advisory written to ai_justification; status remains PROCESSING awaiting authenticated HITL callback.'
  };

  const updatedRecords = state.erp_records.map((rec) =>
    rec.order_id === targetRecord.order_id
      ? {
          ...rec,
          current_status: 'PROCESSING' as const,
          correlation_id: state.correlation_id,
          aws_request_id: awsRequestId,
          ai_justification: advisoryText,
          updated_at: nowIso,
          updated_by: 'system.aws_bedrock_flow'
        }
      : rec
  );

  const telemetrySuccess: TelemetryLogEntry = {
    id: `tel_s3_bdk_${now.getTime()}`,
    timestamp: nowIso,
    stage: 3,
    layer: 'SERVICENOW_BEDROCK',
    severity: 'SUCCESS',
    title: `ServiceNow Outbound SigV4 Bedrock Audit Complete (${targetRecord.order_id} -> PROCESSING)`,
    correlation_id: state.correlation_id,
    traceparent: state.traceparent,
    aws_request_id: awsRequestId,
    payload: {
      order_id: targetRecord.order_id,
      source_table: sourceTable,
      http_status: 200,
      aws_request_id: awsRequestId,
      invariant_1_enforced: 'current_status held at PROCESSING (Flows never auto-release)'
    }
  };

  const nextState: PlaygroundState = {
    ...state,
    bedrock_sigv4_inspection: {
      endpoint:
        'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet-20241022-v2:0/invoke',
      model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      canonical_headers: canonicalHeaders,
      authorization_header_masked: authorizationHeaderMasked,
      aws_request_id: awsRequestId,
      advisory_summary: advisoryText,
      http_status: 200
    },
    erp_records: updatedRecords,
    sn_audit_events: [bedrockSuccessEvent, buttonEvent, ...state.sn_audit_events],
    sys_audit_log: [sysAuditToProcessing, ...state.sys_audit_log],
    telemetry_stream: [telemetrySuccess, ...state.telemetry_stream]
  };

  savePlaygroundState(nextState);
  return nextState;
}

export function executeStage3HitlCallback(
  state: PlaygroundState,
  orderId: string,
  decision: 'APPROVED' | 'DENIED',
  justification: string,
  tokenValid: boolean
): PlaygroundState {
  const now = new Date();
  const nowIso = now.toISOString();
  const targetRecord =
    state.erp_records.find((r) => r.order_id === orderId) || state.erp_records[0];
  const sourceTable = getSourceTableForProcess(targetRecord.process);
  const awsRequestId =
    targetRecord.aws_request_id !== 'pending_invocation'
      ? targetRecord.aws_request_id
      : 'req_bedrock_8841a9c2';

  if (!tokenValid) {
    const securityBlockEvent: ServiceNowAuditEvent = {
      event_id: `sn_evt_sec_${now.getTime()}`,
      timestamp: nowIso,
      process: targetRecord.process,
      order_id: targetRecord.order_id,
      source_table: sourceTable,
      event_type: 'SECURITY_BLOCK',
      correlation_id: state.correlation_id,
      aws_request_id: awsRequestId,
      http_status: 401,
      decision: '401_UNAUTHORIZED_CALLBACK_REJECTED',
      actor: 'anonymous / invalid X-Agent-Callback-Token',
      note: '401 Unauthorized (Constant-Time Token Comparison Failed) on POST /api/x_ent_erp_ovl/v1/agent-callback. Record remains in PROCESSING.'
    };

    const telemetryBlock: TelemetryLogEntry = {
      id: `tel_s3_cb_block_${now.getTime()}`,
      timestamp: nowIso,
      stage: 3,
      layer: 'HITL_CALLBACK',
      severity: 'CRITICAL',
      title: `401 Unauthorized (Constant-Time Token Comparison Failed) on ${targetRecord.order_id} Callback`,
      correlation_id: state.correlation_id,
      traceparent: state.traceparent,
      aws_request_id: awsRequestId,
      payload: {
        endpoint: 'POST /api/x_ent_erp_ovl/v1/agent-callback',
        http_status: 401,
        error: '401 Unauthorized (Constant-Time Token Comparison Failed)',
        record_status_preserved: targetRecord.current_status
      }
    };

    const nextState: PlaygroundState = {
      ...state,
      sn_audit_events: [securityBlockEvent, ...state.sn_audit_events],
      telemetry_stream: [telemetryBlock, ...state.telemetry_stream]
    };

    savePlaygroundState(nextState);
    return nextState;
  }

  const nextStatus = decision === 'APPROVED' ? 'RELEASED' : 'BLOCKED';
  const cleanJustification =
    justification.trim() ||
    (decision === 'APPROVED'
      ? 'Approved by Finance Controller after verifying SWIFT wire confirmation and Bedrock risk advisory.'
      : 'Denied by Finance Controller pending full settlement of past-due balance.');

  const updatedJustification = `${targetRecord.ai_justification}\n\n[HITL Callback ${decision} | ${nowIso}]: ${cleanJustification}`;

  const callbackAuditEvent: ServiceNowAuditEvent = {
    event_id: `sn_evt_cb_${now.getTime()}`,
    timestamp: nowIso,
    process: targetRecord.process,
    order_id: targetRecord.order_id,
    source_table: sourceTable,
    event_type: 'CALLBACK',
    correlation_id: state.correlation_id,
    aws_request_id: awsRequestId,
    http_status: 200,
    decision: `${decision} -> ${nextStatus}`,
    actor: 'sarah.chen@0trust.dev (HITL Controller)',
    note: `Authenticated POST /api/x_ent_erp_ovl/v1/agent-callback verified X-Agent-Callback-Token in constant time. Transitioned ${targetRecord.order_id} to ${nextStatus}.`
  };

  const sysAuditCallback: SysAuditEntry = {
    sys_id: `sys_aud_cb_${now.getTime()}`,
    timestamp: nowIso,
    tablename: sourceTable,
    documentkey: targetRecord.sys_id,
    fieldname: 'current_status',
    oldvalue: targetRecord.current_status,
    newvalue: nextStatus,
    user: 'sarah.chen@0trust.dev'
  };

  const updatedRecords = state.erp_records.map((rec) =>
    rec.order_id === targetRecord.order_id
      ? {
          ...rec,
          current_status: nextStatus as 'RELEASED' | 'BLOCKED',
          correlation_id: state.correlation_id,
          aws_request_id: awsRequestId,
          ai_justification: updatedJustification,
          updated_at: nowIso,
          updated_by: 'sarah.chen@0trust.dev'
        }
      : rec
  );

  const telemetryCallback: TelemetryLogEntry = {
    id: `tel_s3_cb_ok_${now.getTime()}`,
    timestamp: nowIso,
    stage: 3,
    layer: 'HITL_CALLBACK',
    severity: decision === 'APPROVED' ? 'SUCCESS' : 'WARN',
    title: `HITL Callback ${decision}: ${targetRecord.order_id} Transitioned to ${nextStatus}`,
    correlation_id: state.correlation_id,
    traceparent: state.traceparent,
    aws_request_id: awsRequestId,
    payload: {
      endpoint: 'POST /api/x_ent_erp_ovl/v1/agent-callback',
      http_status: 200,
      order_id: targetRecord.order_id,
      decision,
      new_status: nextStatus,
      justification: cleanJustification
    }
  };

  const nextState: PlaygroundState = {
    ...state,
    erp_records: updatedRecords,
    sn_audit_events: [callbackAuditEvent, ...state.sn_audit_events],
    sys_audit_log: [sysAuditCallback, ...state.sys_audit_log],
    telemetry_stream: [telemetryCallback, ...state.telemetry_stream]
  };

  savePlaygroundState(nextState);
  return nextState;
}

export function runFullEndToEndJourney(state: PlaygroundState): PlaygroundState {
  const baseState: PlaygroundState = {
    ...state,
    persona: 'erp-operator',
    selected_order_id: state.selected_order_id || 'ORD-1042'
  };

  const afterStage1 = executeStage1TokenExchange(baseState, 'NONE');
  const afterStage2 = executeStage2McpPolicy(afterStage1, 'COMPLIANT_AUDIT');
  const afterStage3 = executeStage3BedrockAudit(
    afterStage2,
    baseState.selected_order_id,
    false
  );

  const finalState: PlaygroundState = {
    ...afterStage3,
    active_stage: 3
  };

  savePlaygroundState(finalState);
  return finalState;
}

// ============================================================================
// Edge Proxy Client + Automatic Browser Fallback (`vite dev`) for Lab 2
// ============================================================================

export type Stage1AttackMode =
  | 'NONE'
  | 'RAW_JWT_FORWARD'
  | 'ID_JAG_WRONG_AUD'
  | 'SPOOF_GCP_SA';

export type Stage2Scenario =
  | 'COMPLIANT_AUDIT'
  | 'RBAC_VIOLATION'
  | 'DLP_SECRET_LEAK'
  | 'LOW_VALUE_AUTO';

export interface AgenticEdgeCallResult {
  ok: boolean;
  status: number;
  nextState: PlaygroundState;
  span: import('../types').ObservabilitySpan;
}

let agenticEdgeAvailable: boolean | null = null;

function randomHexBytes(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteCount; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createAgenticVisitorSessionId(): string {
  return `vis_ag_${randomHexBytes(6)}`;
}

function buildTraceparentFromExisting(existing?: string): {
  traceparent: string;
  traceId: string;
  spanId: string;
  parentSpanId: string;
} {
  const spanId = randomHexBytes(8);
  if (existing) {
    const match = existing.trim().match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
    if (match) {
      return {
        traceparent: `00-${match[1].toLowerCase()}-${spanId}-01`,
        traceId: match[1].toLowerCase(),
        parentSpanId: match[2].toLowerCase(),
        spanId
      };
    }
  }
  const traceId = randomHexBytes(16);
  return {
    traceparent: `00-${traceId}-${spanId}-01`,
    traceId,
    parentSpanId: '0000000000000000',
    spanId
  };
}

function redactJwtTokenPreview(raw?: string | null): {
  redacted: string | null;
  changed: boolean;
} {
  if (!raw) return { redacted: null, changed: false };
  let changed = false;
  const redacted = raw.replace(
    /\b(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.)([A-Za-z0-9_-]+)\b/g,
    (_m, prefix) => {
      changed = true;
      return `${prefix}***REDACTED***`;
    }
  );
  return { redacted, changed };
}

async function tryEdgePost(
  path: string,
  sessionId: string,
  traceparent: string,
  authHeader: string | null,
  body: Record<string, unknown>
): Promise<{
  handledByEdge: boolean;
  status: number;
  json: Record<string, unknown> | null;
  latencyMs: number;
}> {
  if (typeof window !== 'undefined' && agenticEdgeAvailable === null) {
    try {
      const probe = await fetch('/api/agentic-transaction/state', { method: 'GET' });
      const probeCt = probe.headers.get('Content-Type') || '';
      agenticEdgeAvailable = probeCt.includes('application/json');
    } catch {
      agenticEdgeAvailable = false;
    }
  }
  if (agenticEdgeAvailable === false) {
    return { handledByEdge: false, status: 0, json: null, latencyMs: 1 };
  }
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
      traceparent
    };
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }
    const res = await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, sessionId })
    });
    const latencyMs = Math.max(
      1,
      Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start)
    );
    const ct = res.headers.get('Content-Type') || '';
    if (!ct.includes('application/json')) {
      agenticEdgeAvailable = false;
      return { handledByEdge: false, status: res.status, json: null, latencyMs };
    }
    const data = (await res.json()) as Record<string, unknown>;
    agenticEdgeAvailable = true;
    return { handledByEdge: true, status: res.status, json: data, latencyMs };
  } catch {
    agenticEdgeAvailable = false;
    return { handledByEdge: false, status: 0, json: null, latencyMs: 2 };
  }
}

function buildObservabilitySpan(params: {
  path: string;
  sessionId: string;
  traceInfo: { traceparent: string; traceId: string; spanId: string; parentSpanId: string };
  status: number;
  latencyMs: number;
  authHeader: string | null;
  origin: 'cloudflare-edge' | 'browser-webcrypto-fallback';
  edgeTelemetry?: Record<string, unknown>;
  responseSummary: Record<string, unknown>;
}): import('../types').ObservabilitySpan {
  const redaction = redactJwtTokenPreview(params.authHeader);
  const edgeTel = params.edgeTelemetry;
  return {
    id: `span_${Date.now()}_${randomHexBytes(3)}`,
    traceparent:
      (typeof edgeTel?.traceparent === 'string' && edgeTel.traceparent) ||
      params.traceInfo.traceparent,
    trace_id:
      (typeof edgeTel?.trace_id === 'string' && edgeTel.trace_id) ||
      params.traceInfo.traceId,
    span_id:
      (typeof edgeTel?.span_id === 'string' && edgeTel.span_id) ||
      params.traceInfo.spanId,
    parent_span_id:
      (typeof edgeTel?.parent_span_id === 'string' && edgeTel.parent_span_id) ||
      params.traceInfo.parentSpanId,
    session_id: params.sessionId,
    method: 'POST',
    path: params.path,
    status: params.status,
    latency_ms:
      typeof edgeTel?.latency_ms === 'number' ? edgeTel.latency_ms : params.latencyMs,
    timestamp: new Date().toISOString(),
    otlp_export:
      edgeTel?.otlp_export === 'configured' ? 'configured' : 'in-lab-only',
    redacted_auth_header:
      typeof edgeTel?.redacted_auth_header === 'string'
        ? edgeTel.redacted_auth_header
        : redaction.redacted,
    redaction_applied:
      typeof edgeTel?.redaction_applied === 'boolean'
        ? edgeTel.redaction_applied
        : redaction.changed,
    execution_origin: params.origin,
    response_summary: params.responseSummary
  };
}

export async function callStage1ExchangeApi(
  state: PlaygroundState,
  sessionId: string,
  attackMode: Stage1AttackMode = 'NONE'
): Promise<AgenticEdgeCallResult> {
  const path = '/api/agentic-transaction/exchange';
  const traceInfo = buildTraceparentFromExisting(state.traceparent);
  const localNext = executeStage1TokenExchange(
    { ...state, traceparent: traceInfo.traceparent },
    attackMode
  );
  const rawJag = localNext.token_bundle?.okta_id_jag_jwt.raw_jwt;
  const authHeader = rawJag ? `Bearer ${rawJag}` : null;

  const edgeRes = await tryEdgePost(path, sessionId, traceInfo.traceparent, authHeader, {
    persona: state.persona,
    order_id: state.selected_order_id,
    attack_mode: attackMode
  });

  const httpStatus = edgeRes.handledByEdge
    ? edgeRes.status
    : attackMode === 'NONE'
      ? 200
      : 403;

  const nextState: PlaygroundState =
    edgeRes.handledByEdge && edgeRes.json?.token_bundle
      ? {
          ...localNext,
          token_bundle: edgeRes.json.token_bundle as TokenExchangeBundle
        }
      : localNext;

  savePlaygroundState(nextState);

  const span = buildObservabilitySpan({
    path,
    sessionId,
    traceInfo,
    status: httpStatus,
    latencyMs: edgeRes.latencyMs,
    authHeader,
    origin: edgeRes.handledByEdge ? 'cloudflare-edge' : 'browser-webcrypto-fallback',
    edgeTelemetry: edgeRes.json?._telemetry as Record<string, unknown> | undefined,
    responseSummary: {
      status: nextState.token_bundle?.status,
      expires_in: 900,
      stripped_at_frontdoor:
        nextState.token_bundle?.inbound_auth0_jwt.stripped_at_frontdoor,
      attack_mode: attackMode,
      error_code: nextState.token_bundle?.error_code || null,
      okta_aud: nextState.token_bundle?.okta_id_jag_jwt.payload.aud,
      aws_assumed_role: nextState.token_bundle?.aws_sts_session.assumed_role_arn,
      kv_ttl_seconds: 3600
    }
  });

  return {
    ok: httpStatus >= 200 && httpStatus < 300,
    status: httpStatus,
    nextState,
    span
  };
}

export async function callStage2ExecuteApi(
  state: PlaygroundState,
  sessionId: string,
  scenario: Stage2Scenario
): Promise<AgenticEdgeCallResult> {
  const path = '/api/agentic-transaction/execute';
  const traceInfo = buildTraceparentFromExisting(state.traceparent);
  const localNext = executeStage2McpPolicy(
    { ...state, traceparent: traceInfo.traceparent },
    scenario
  );
  const rawJag = state.token_bundle?.okta_id_jag_jwt.raw_jwt;
  const authHeader = rawJag ? `Bearer ${rawJag}` : null;

  const edgeRes = await tryEdgePost(path, sessionId, traceInfo.traceparent, authHeader, {
    persona: state.persona,
    order_id: state.selected_order_id,
    scenario
  });

  const decision = localNext.mcp_result?.overall_decision;
  const fallbackStatus =
    decision === 'DENIED_RBAC' || decision === 'DENIED_DLP'
      ? 403
      : decision === 'ESCALATED_HITL'
        ? 202
        : 200;

  const httpStatus = edgeRes.handledByEdge ? edgeRes.status : fallbackStatus;

  const nextState: PlaygroundState =
    edgeRes.handledByEdge && edgeRes.json?.mcp_result
      ? {
          ...localNext,
          mcp_result: edgeRes.json.mcp_result as McpEvaluationResult
        }
      : localNext;

  savePlaygroundState(nextState);

  const span = buildObservabilitySpan({
    path,
    sessionId,
    traceInfo,
    status: httpStatus,
    latencyMs: edgeRes.latencyMs,
    authHeader,
    origin: edgeRes.handledByEdge ? 'cloudflare-edge' : 'browser-webcrypto-fallback',
    edgeTelemetry: edgeRes.json?._telemetry as Record<string, unknown> | undefined,
    responseSummary: {
      scenario,
      overall_decision: nextState.mcp_result?.overall_decision,
      rbac_status: nextState.mcp_result?.rbac_status,
      dlp_status: nextState.mcp_result?.dlp_status,
      dlp_matched_rule: nextState.mcp_result?.dlp_matched_rule || null,
      hitl_status: nextState.mcp_result?.hitl_status,
      hitl_ticket_id: nextState.mcp_result?.hitl_ticket_id || null,
      kv_ttl_seconds: 3600
    }
  });

  return {
    ok: httpStatus >= 200 && httpStatus < 300,
    status: httpStatus,
    nextState,
    span
  };
}

export async function callStage3ApproveApi(
  state: PlaygroundState,
  sessionId: string,
  params:
    | {
        action: 'bedrock_advisory';
        orderId: string;
        simulateTimeout?: boolean;
      }
    | {
        action: 'hitl_callback';
        orderId: string;
        decision: 'APPROVED' | 'DENIED';
        justification: string;
        tokenValid: boolean;
      }
): Promise<AgenticEdgeCallResult> {
  const path = '/api/agentic-transaction/approve';
  const traceInfo = buildTraceparentFromExisting(state.traceparent);
  const rawJag = state.token_bundle?.okta_id_jag_jwt.raw_jwt;
  const authHeader = rawJag ? `Bearer ${rawJag}` : null;

  const localNext =
    params.action === 'bedrock_advisory'
      ? executeStage3BedrockAudit(
          { ...state, traceparent: traceInfo.traceparent },
          params.orderId,
          Boolean(params.simulateTimeout)
        )
      : executeStage3HitlCallback(
          { ...state, traceparent: traceInfo.traceparent },
          params.orderId,
          params.decision,
          params.justification,
          params.tokenValid
        );

  const requestBody: Record<string, unknown> =
    params.action === 'bedrock_advisory'
      ? {
          action: 'bedrock_advisory',
          order_id: params.orderId,
          simulate_timeout: Boolean(params.simulateTimeout)
        }
      : {
          action: 'hitl_callback',
          order_id: params.orderId,
          decision: params.decision,
          justification: params.justification,
          callback_token_valid: params.tokenValid
        };

  const edgeRes = await tryEdgePost(
    path,
    sessionId,
    traceInfo.traceparent,
    authHeader,
    requestBody
  );

  const fallbackStatus =
    params.action === 'bedrock_advisory'
      ? params.simulateTimeout
        ? 504
        : 200
      : params.tokenValid
        ? 200
        : 401;

  const httpStatus = edgeRes.handledByEdge ? edgeRes.status : fallbackStatus;

  savePlaygroundState(localNext);

  const updatedOrder = localNext.erp_records.find((r) => r.order_id === params.orderId);

  const span = buildObservabilitySpan({
    path,
    sessionId,
    traceInfo,
    status: httpStatus,
    latencyMs: edgeRes.latencyMs,
    authHeader,
    origin: edgeRes.handledByEdge ? 'cloudflare-edge' : 'browser-webcrypto-fallback',
    edgeTelemetry: edgeRes.json?._telemetry as Record<string, unknown> | undefined,
    responseSummary:
      params.action === 'bedrock_advisory'
        ? {
            action: 'bedrock_advisory',
            order_id: params.orderId,
            http_status: httpStatus,
            aws_request_id: localNext.bedrock_sigv4_inspection?.aws_request_id,
            record_status: updatedOrder?.current_status,
            kv_ttl_seconds: 3600
          }
        : {
            action: 'hitl_callback',
            order_id: params.orderId,
            http_status: httpStatus,
            decision: params.decision,
            callback_token_valid: params.tokenValid,
            record_status: updatedOrder?.current_status,
            kv_ttl_seconds: 3600
          }
  });

  return {
    ok: httpStatus >= 200 && httpStatus < 300,
    status: httpStatus,
    nextState: localNext,
    span
  };
}

