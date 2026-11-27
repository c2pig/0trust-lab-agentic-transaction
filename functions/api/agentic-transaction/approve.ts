import {
  AGENTIC_SESSION_TTL_SECONDS,
  type AgenticTransactionEnv,
  checkAndIncrementDailyCap,
  constantTimeEqual,
  DEFAULT_CALLBACK_SECRET,
  generateCallbackToken,
  getSourceTableForProcess,
  jsonResponse,
  loadAgenticSession,
  saveAgenticSession
} from './_shared';
import type {
  ServiceNowAuditEvent,
  SysAuditEntry,
  TelemetryLogEntry
} from '../../../src/types';

type ApproveAction = 'bedrock_advisory' | 'hitl_callback';

export async function onRequestPost(context: {
  request: Request;
  env: AgenticTransactionEnv;
}): Promise<Response> {
  let body: {
    sessionId?: string;
    action?: ApproveAction;
    order_id?: string;
    simulate_timeout?: boolean;
    decision?: 'APPROVED' | 'DENIED';
    justification?: string;
    callback_token_valid?: boolean;
    callback_token?: string;
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

  const action: ApproveAction =
    body.action === 'hitl_callback' ? 'hitl_callback' : 'bedrock_advisory';
  const orderId =
    typeof body.order_id === 'string' && body.order_id.trim()
      ? body.order_id.trim()
      : session.selected_order_id;

  const targetRecord =
    session.erp_records.find((r) => r.order_id === orderId) || session.erp_records[0];
  const sourceTable = getSourceTableForProcess(targetRecord.process);
  const now = new Date();
  const nowIso = now.toISOString();
  const capInfo = await checkAndIncrementDailyCap(context.env);

  // ==================== BRANCH 1: BEDROCK SIGV4 ADVISORY ====================
  if (action === 'bedrock_advisory') {
    const simulateTimeout = Boolean(body.simulate_timeout);
    const amzDate = nowIso.replace(/[:-]|\.\d{3}/g, '');
    const awsRequestId = 'req_bedrock_8841a9c2';

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
      correlation_id: session.correlation_id,
      aws_request_id: awsRequestId,
      http_status: 202,
      decision: 'PROCESSING',
      actor: 'elena.vance@0trust.dev (Workspace UI Action)',
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
      user: 'elena.vance@0trust.dev'
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
        correlation_id: session.correlation_id,
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

      const updatedRecords = session.erp_records.map((rec) =>
        rec.order_id === targetRecord.order_id
          ? {
              ...rec,
              current_status: 'BLOCKED' as const,
              correlation_id: session.correlation_id,
              aws_request_id: awsRequestId,
              ai_justification: timeoutJustification,
              updated_at: nowIso,
              updated_by: 'system.aws_bedrock_flow'
            }
          : rec
      );

      const sigv4Inspection = {
        endpoint:
          'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet-20241022-v2:0/invoke',
        model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        canonical_headers: canonicalHeaders,
        authorization_header_masked: authorizationHeaderMasked,
        aws_request_id: awsRequestId,
        advisory_summary:
          'HTTP 504 Gateway Timeout from AWS Bedrock runtime. Record automatically reverted to BLOCKED.',
        http_status: 504
      };

      const telemetryTimeout: TelemetryLogEntry = {
        id: `tel_s3_timeout_${now.getTime()}`,
        timestamp: nowIso,
        stage: 3,
        layer: 'SERVICENOW_BEDROCK',
        severity: 'WARN',
        title: `Bedrock SigV4 Timeout (HTTP 504) on ${targetRecord.order_id} — Record Reverted to BLOCKED`,
        correlation_id: session.correlation_id,
        traceparent: session.traceparent,
        aws_request_id: awsRequestId,
        payload: {
          order_id: targetRecord.order_id,
          http_status: 504,
          status_transition: 'BLOCKED -> PROCESSING -> BLOCKED',
          aws_request_id: awsRequestId
        }
      };

      const updatedSession = {
        ...session,
        selected_order_id: targetRecord.order_id,
        bedrock_sigv4_inspection: sigv4Inspection,
        erp_records: updatedRecords,
        sn_audit_events: [bedrockTimeoutEvent, buttonEvent, ...session.sn_audit_events],
        sys_audit_log: [sysAuditRevert, sysAuditToProcessing, ...session.sys_audit_log]
      };

      const storage = await saveAgenticSession(context.env, sessionId, updatedSession);

      return jsonResponse(
        {
          status: 'REVERTED_TO_BLOCKED',
          http_status: 504,
          action: 'bedrock_advisory',
          order_id: targetRecord.order_id,
          aws_request_id: awsRequestId,
          bedrock_sigv4_inspection: sigv4Inspection,
          updated_record: updatedRecords.find((r) => r.order_id === targetRecord.order_id),
          sn_audit_events: [bedrockTimeoutEvent, buttonEvent],
          sys_audit_entries: [sysAuditRevert, sysAuditToProcessing],
          telemetry_entry: telemetryTimeout,
          session_id: sessionId,
          storage,
          kv_ttl_seconds: AGENTIC_SESSION_TTL_SECONDS,
          circuit_breaker: capInfo
        },
        504
      );
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
      correlation_id: session.correlation_id,
      aws_request_id: awsRequestId,
      http_status: 200,
      decision: 'ADVISORY_APPENDED_AWAITING_HITL',
      actor: 'system.aws_bedrock_flow',
      note: 'SigV4 Bedrock invocation succeeded (HTTP 200). AI advisory written to ai_justification; status remains PROCESSING awaiting authenticated HITL callback.'
    };

    const updatedRecords = session.erp_records.map((rec) =>
      rec.order_id === targetRecord.order_id
        ? {
            ...rec,
            current_status: 'PROCESSING' as const,
            correlation_id: session.correlation_id,
            aws_request_id: awsRequestId,
            ai_justification: advisoryText,
            updated_at: nowIso,
            updated_by: 'system.aws_bedrock_flow'
          }
        : rec
    );

    const sigv4Inspection = {
      endpoint:
        'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet-20241022-v2:0/invoke',
      model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      canonical_headers: canonicalHeaders,
      authorization_header_masked: authorizationHeaderMasked,
      aws_request_id: awsRequestId,
      advisory_summary: advisoryText,
      http_status: 200
    };

    const telemetrySuccess: TelemetryLogEntry = {
      id: `tel_s3_bdk_${now.getTime()}`,
      timestamp: nowIso,
      stage: 3,
      layer: 'SERVICENOW_BEDROCK',
      severity: 'SUCCESS',
      title: `ServiceNow Outbound SigV4 Bedrock Audit Complete (${targetRecord.order_id} -> PROCESSING)`,
      correlation_id: session.correlation_id,
      traceparent: session.traceparent,
      aws_request_id: awsRequestId,
      payload: {
        order_id: targetRecord.order_id,
        source_table: sourceTable,
        http_status: 200,
        aws_request_id: awsRequestId,
        invariant_1_enforced: 'current_status held at PROCESSING (Flows never auto-release)'
      }
    };

    const hitlCallbackToken = generateCallbackToken();

    const updatedSession = {
      ...session,
      selected_order_id: targetRecord.order_id,
      bedrock_sigv4_inspection: sigv4Inspection,
      erp_records: updatedRecords,
      sn_audit_events: [bedrockSuccessEvent, buttonEvent, ...session.sn_audit_events],
      sys_audit_log: [sysAuditToProcessing, ...session.sys_audit_log],
      hitl_callback_token: hitlCallbackToken
    };

    const storage = await saveAgenticSession(context.env, sessionId, updatedSession);

    return jsonResponse(
      {
        status: 'ADVISORY_APPENDED_AWAITING_HITL',
        http_status: 200,
        action: 'bedrock_advisory',
        order_id: targetRecord.order_id,
        aws_request_id: awsRequestId,
        hitl_callback_token: hitlCallbackToken,
        bedrock_sigv4_inspection: sigv4Inspection,
        updated_record: updatedRecords.find((r) => r.order_id === targetRecord.order_id),
        sn_audit_events: [bedrockSuccessEvent, buttonEvent],
        sys_audit_entries: [sysAuditToProcessing],
        telemetry_entry: telemetrySuccess,
        session_id: sessionId,
        storage,
        kv_ttl_seconds: AGENTIC_SESSION_TTL_SECONDS,
        circuit_breaker: capInfo
      },
      200
    );
  }

  // ==================== BRANCH 2: HITL CALLBACK (CONSTANT-TIME TOKEN CHECK) ====================
  const isProd = context.env.ENVIRONMENT === 'production';
  const configuredSecret =
    context.env.SN_AGENT_CALLBACK_TOKEN || (isProd ? '' : DEFAULT_CALLBACK_SECRET);
  const sessionToken =
    typeof session.hitl_callback_token === 'string' ? session.hitl_callback_token : '';

  const headerToken = context.request.headers.get('X-Agent-Callback-Token');
  const candidateToken =
    headerToken !== null
      ? headerToken
      : typeof body.callback_token === 'string'
        ? body.callback_token
        : '';

  const matchesConfigured =
    configuredSecret.length > 0 && constantTimeEqual(candidateToken, configuredSecret);
  const matchesSession =
    sessionToken.length > 0 && constantTimeEqual(candidateToken, sessionToken);

  const isTokenValid =
    candidateToken.length > 0 &&
    body.callback_token_valid !== false &&
    (matchesConfigured || matchesSession);

  const awsRequestId =
    targetRecord.aws_request_id !== 'pending_invocation'
      ? targetRecord.aws_request_id
      : 'req_bedrock_8841a9c2';

  if (!isTokenValid) {
    const securityBlockEvent: ServiceNowAuditEvent = {
      event_id: `sn_evt_sec_${now.getTime()}`,
      timestamp: nowIso,
      process: targetRecord.process,
      order_id: targetRecord.order_id,
      source_table: sourceTable,
      event_type: 'SECURITY_BLOCK',
      correlation_id: session.correlation_id,
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
      correlation_id: session.correlation_id,
      traceparent: session.traceparent,
      aws_request_id: awsRequestId,
      payload: {
        endpoint: 'POST /api/x_ent_erp_ovl/v1/agent-callback',
        http_status: 401,
        error: '401 Unauthorized (Constant-Time Token Comparison Failed)',
        record_status_preserved: targetRecord.current_status
      }
    };

    const updatedSession = {
      ...session,
      sn_audit_events: [securityBlockEvent, ...session.sn_audit_events]
    };

    const storage = await saveAgenticSession(context.env, sessionId, updatedSession);

    return jsonResponse(
      {
        status: '401_UNAUTHORIZED_CALLBACK_REJECTED',
        http_status: 401,
        action: 'hitl_callback',
        error: '401 Unauthorized (Constant-Time Token Comparison Failed)',
        order_id: targetRecord.order_id,
        record_status_preserved: targetRecord.current_status,
        sn_audit_events: [securityBlockEvent],
        telemetry_entry: telemetryBlock,
        session_id: sessionId,
        storage,
        kv_ttl_seconds: AGENTIC_SESSION_TTL_SECONDS,
        circuit_breaker: capInfo
      },
      401
    );
  }

  const decision: 'APPROVED' | 'DENIED' = body.decision === 'DENIED' ? 'DENIED' : 'APPROVED';
  const nextStatus = decision === 'APPROVED' ? 'RELEASED' : 'BLOCKED';
  const cleanJustification =
    (typeof body.justification === 'string' ? body.justification.trim() : '') ||
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
    correlation_id: session.correlation_id,
    aws_request_id: awsRequestId,
    http_status: 200,
    decision: `${decision} -> ${nextStatus}`,
    actor: 'elena.vance@0trust.dev (HITL Finance Manager)',
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
    user: 'elena.vance@0trust.dev'
  };

  const updatedRecords = session.erp_records.map((rec) =>
    rec.order_id === targetRecord.order_id
      ? {
          ...rec,
          current_status: nextStatus as 'RELEASED' | 'BLOCKED',
          correlation_id: session.correlation_id,
          aws_request_id: awsRequestId,
          ai_justification: updatedJustification,
          updated_at: nowIso,
          updated_by: 'elena.vance@0trust.dev'
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
    correlation_id: session.correlation_id,
    traceparent: session.traceparent,
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

  const updatedSession = {
    ...session,
    selected_order_id: targetRecord.order_id,
    erp_records: updatedRecords,
    sn_audit_events: [callbackAuditEvent, ...session.sn_audit_events],
    sys_audit_log: [sysAuditCallback, ...session.sys_audit_log]
  };

  const storage = await saveAgenticSession(context.env, sessionId, updatedSession);

  return jsonResponse(
    {
      status: `${decision}_${nextStatus}`,
      http_status: 200,
      action: 'hitl_callback',
      decision,
      new_status: nextStatus,
      order_id: targetRecord.order_id,
      updated_record: updatedRecords.find((r) => r.order_id === targetRecord.order_id),
      sn_audit_events: [callbackAuditEvent],
      sys_audit_entries: [sysAuditCallback],
      telemetry_entry: telemetryCallback,
      session_id: sessionId,
      storage,
      kv_ttl_seconds: AGENTIC_SESSION_TTL_SECONDS,
      circuit_breaker: capInfo
    },
    200
  );
}
