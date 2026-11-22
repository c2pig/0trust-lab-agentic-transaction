import { ErpExceptionRecord } from '../types';

export interface PillarRepository {
  name: string;
  pillar: string;
  status: 'PRODUCTION_POC' | 'VERIFIED_CONTRACT' | 'ACTIVE_HARNESS';
  url: string;
  summary: string;
  invariants: string[];
  techStack: string[];
}

export interface ValueStreamContract {
  id: 'agentic-transaction' | 'workforce-journey' | 'secops-resilience';
  route: string;
  title: string;
  status: 'LIVE_INTERACTIVE' | 'BLUEPRINT_READY';
  stages: string[];
  summary: string;
}

export const PILLAR_REPOSITORIES: PillarRepository[] = [
  {
    name: 'cross-cloud-agent-identity',
    pillar: 'Pillar 1: Cross-Cloud Federated Agent Identity',
    status: 'PRODUCTION_POC',
    url: 'https://github.com/dremdem/cross-cloud-agent-identity',
    summary:
      'Cryptographic On-Behalf-Of (OBO) identity propagation from Cloud Run Frontdoor through Vertex AI Agent Engine to AWS Bedrock AgentCore via GCP OIDC and AWS STS AssumeRoleWithWebIdentity—with zero static keys.',
    invariants: [
      'Frontdoor strips inbound user Authorization header after verification (stripped_at_frontdoor: true); raw user JWT never forwarded downstream',
      'Okta RFC 8693 Token Exchange mints 15-minute (900s) oauth-id-jag+jwt assertion scoped to target agent audience',
      'Vertex AI Agent Engine attaches workload identity OIDC token bound to GCP Service Account sub & aud claims',
      'AWS IAM Trust Policy enforces StringEquals on accounts.google.com:sub and accounts.google.com:aud',
      'End-to-end W3C traceparent and correlation_id preserved across GCP and AWS CloudTrail logs'
    ],
    techStack: ['GCP Cloud Run', 'Vertex AI Agent Engine', 'AWS STS OIDC', 'AWS Bedrock AgentCore', 'Python 3.12']
  },
  {
    name: 'iam-demo',
    pillar: 'Pillar 2: Enterprise Workforce & Agent IAM (Okta + Auth0)',
    status: 'PRODUCTION_POC',
    url: 'https://github.com/dremdem/iam-demo',
    summary:
      'Dual-IdP reference architecture uniting Auth0 B2C/CIAM with Okta Workforce Identity, RFC 8693 OAuth 2.0 Token Exchange (ID-JAG), SCIM 2.0 lifecycle automation, and SSF/CAEP continuous session revocation.',
    invariants: [
      'RFC 8693 Token Exchange mints short-lived oauth-id-jag+jwt tokens scoped to target agent audience',
      'Auth0 Action Cryptographic Bridge binds human subject (sub) and delegating client_id (act) claims',
      '15-minute JIT PAM privilege elevation auto-revokes via Okta Workflows & Shared Signals Framework (SSF)',
      'Universal Logout terminates active OAuth refresh tokens and downstream agent sessions within seconds'
    ],
    techStack: ['Okta Workforce Identity', 'Auth0 CIAM', 'RFC 8693 ID-JAG', 'SCIM 2.0', 'OpenID SSF/CAEP']
  },
  {
    name: 'agent-governance',
    pillar: 'Pillar 3: MCP Runtime Governance & Policy Interceptor',
    status: 'PRODUCTION_POC',
    url: 'https://github.com/dremdem/agent-governance',
    summary:
      'Deterministic JSON-RPC 2.0 Model Context Protocol (MCP) policy interceptor enforcing persona-based tool allowlists, regex DLP payload inspection, and financial threshold Human-in-the-Loop (HITL) escalation gates.',
    invariants: [
      'Every MCP tools/call payload is evaluated against RBAC allowlists before tool dispatch (-32001 on deny)',
      'Outbound arguments and inbound results are scanned by deterministic DLP rules (-32002 on secret leak)',
      'High-impact mutations exceeding $200.00 halt synchronous execution and mint a ServiceNow HITL approval ticket',
      'Immutable JSONL telemetry records correlation_id, persona, matched rule ID, and latency for every interception'
    ],
    techStack: ['MCP JSON-RPC 2.0', 'Policy-as-Code JSON', 'DLP Regex Engine', 'HITL Escalation', 'Python FastAPI']
  },
  {
    name: 'now-erp-overlay-app',
    pillar: 'Pillar 4: ServiceNow Order-to-Cash AI Exception Overlay',
    status: 'PRODUCTION_POC',
    url: 'https://github.com/dremdem/now-erp-overlay-app',
    summary:
      'Scoped ServiceNow application (x_ent_erp_ovl) covering all 5 Order-to-Cash stages with Outbound AWS SigV4 Bedrock reasoning and constant-time authenticated asynchronous HITL callback release.',
    invariants: [
      'Invariant 1: ServiceNow Flows set status to PROCESSING and invoke Bedrock; Flows NEVER auto-release holds',
      'Invariant 2: Outbound Bedrock calls use ephemeral STS credentials signed with canonical AWS SigV4 headers',
      'Invariant 3: Only POST /api/x_ent_erp_ovl/v1/agent-callback with constant-time X-Agent-Callback-Token can transition records to RELEASED',
      'Invariant 4: Every state delta writes both a sys_audit field change and an x_ent_erp_ovl_audit_event row joined by correlation_id + aws_request_id'
    ],
    techStack: ['ServiceNow Fluent SDK', 'Scoped App x_ent_erp_ovl', 'AWS Bedrock Claude 3.5', 'AWS SigV4', 'Scripted REST API']
  },
  {
    name: 'managed-infrastructure',
    pillar: 'Pillar 5: Ephemeral Multi-Cloud IaC & Zero-Drift Contracts',
    status: 'VERIFIED_CONTRACT',
    url: 'https://github.com/dremdem/managed-infrastructure',
    summary:
      'Modular Terraform stacks codifying AWS-GCP OIDC federation, least-privilege IAM roles, automated .env contract generation, and scheduled weekly canonical state resets to maintain zero-cost hygiene.',
    invariants: [
      'Zero hardcoded cloud account IDs or long-lived IAM user access keys in any Terraform state or repo',
      'export-env.sh bridges Terraform outputs directly into application runtime contracts without manual copy-paste',
      'Automated weekly teardown and canonical re-seeding guarantees deterministic sandbox behavior',
      'Strict separation between reusable modules/aws-gcp-oidc-trust and deployable stacks/showcase environments'
    ],
    techStack: ['Terraform >= 1.5', 'AWS IAM OIDC', 'Google Cloud IAM', 'Cloudflare Pages & D1', 'GitHub Actions Cron']
  },
  {
    name: 'attack-vector-navigator',
    pillar: 'Specialized Security Tooling: Adversarial Simulation',
    status: 'ACTIVE_HARNESS',
    url: 'https://github.com/dremdem/attack-vector-navigator',
    summary:
      'Interactive MITRE ATLAS & OWASP LLM Top 10 threat modeling navigator mapped to concrete IAM, MCP, and cross-cloud Confused Deputy controls.',
    invariants: [
      'Maps every adversarial technique to a verifiable architectural control and telemetry signature',
      'Simulates token replay, audience spoofing, and indirect prompt injection kill-chains'
    ],
    techStack: ['TypeScript', 'React', 'MITRE ATLAS', 'OWASP LLM Top 10']
  },
  {
    name: 'ai-test-harness',
    pillar: 'Specialized Security Tooling: Deterministic Eval & Red-Teaming',
    status: 'ACTIVE_HARNESS',
    url: 'https://github.com/dremdem/ai-test-harness',
    summary:
      'Automated regression and adversarial red-team harness verifying agent policy compliance, prompt injection resistance, and schema determinism prior to production release.',
    invariants: [
      'Blocks deployment if any adversarial prompt bypasses MCP RBAC or DLP guardrails',
      'Asserts 100% deterministic JSON schema adherence across model temperature sweeps'
    ],
    techStack: ['Python', 'Pytest', 'LLM Red-Teaming', 'JSON Schema Validation']
  },
  {
    name: 'quality-gate-demo',
    pillar: 'Specialized Security Tooling: DevSecOps Supply Chain Gates',
    status: 'VERIFIED_CONTRACT',
    url: 'https://github.com/dremdem/quality-gate-demo',
    summary:
      'CI/CD DevSecOps quality gate enforcing SLSA Level 3 provenance, Cosign container signing, CycloneDX AI-BOM generation, and zero-high-CVE admission policies.',
    invariants: [
      'Every artifact requires cryptographic signature verification via Sigstore Cosign before promotion',
      'Generates machine-readable CycloneDX SBOM/AI-BOM enumerating model weights, prompts, and MCP tools'
    ],
    techStack: ['GitHub Actions', 'Sigstore Cosign', 'SLSA Level 3', 'CycloneDX AI-BOM', 'OPA Gatekeeper']
  },
  {
    name: 'terminal-gpt-mini',
    pillar: 'Specialized Security Tooling: Sandboxed CLI Agent Runtime',
    status: 'ACTIVE_HARNESS',
    url: 'https://github.com/dremdem/terminal-gpt-mini',
    summary:
      'Minimalist, zero-trust CLI agent runtime demonstrating explicit human confirmation gates and strict local command allowlisting for developer workstations.',
    invariants: [
      'Never executes shell mutations without explicit interactive operator confirmation',
      'Restricts environment variable access to prevent accidental credential exfiltration'
    ],
    techStack: ['Python', 'CLI Sandbox', 'Least-Privilege Execution']
  }
];

export const VALUE_STREAMS: ValueStreamContract[] = [
  {
    id: 'agentic-transaction',
    route: '/agentic-transaction',
    title: 'Value Stream 1: Autonomous Agent Transaction',
    status: 'LIVE_INTERACTIVE',
    stages: [
      'Stage 1 Okta ID-JAG & GCP↔AWS OBO',
      'Stage 2 MCP Policy Interceptor',
      'Stage 3 ServiceNow Order-to-Cash Bedrock HITL'
    ],
    summary:
      'End-to-end interactive control plane tracing an enterprise operator request from Okta RFC 8693 ID-JAG token exchange and GCP→AWS STS federation through an MCP RBAC/DLP/HITL interceptor into a ServiceNow Order-to-Cash credit hold release powered by AWS Bedrock.'
  },
  {
    id: 'workforce-journey',
    route: '/workforce-journey',
    title: 'Value Stream 2: Workforce-to-Edge Zero Trust',
    status: 'BLUEPRINT_READY',
    stages: [
      'Stage 1 JML/SCIM & 15m JIT PAM',
      'Stage 2 Cloudflare CASB/SASE & Shadow AI DLP',
      'Stage 3 Okta ITP, SSF/CAEP & Universal Logout'
    ],
    summary:
      'Continuous workforce identity governance combining HR-driven SCIM provisioning, 15-minute ephemeral privileged access elevation, Cloudflare Zero Trust inline Shadow AI DLP inspection, and real-time OpenID SSF/CAEP session revocation.'
  },
  {
    id: 'secops-resilience',
    route: '/secops-resilience',
    title: 'Value Stream 3: AI Supply Chain & Runtime Kill Switch',
    status: 'BLUEPRINT_READY',
    stages: [
      'Stage 1 SLSA L3, Cosign & CycloneDX AI-BOM',
      'Stage 2 Indirect Prompt Injection Canary Tripwires',
      'Stage 3 3-Tier Agentic Kill Switch'
    ],
    summary:
      'Defense-in-depth AI SecOps architecture uniting cryptographic model/container provenance (SLSA L3 + Cosign) with runtime canary token tripwires that trigger automated 3-tier containment across MCP tools, IAM roles, and IdP sessions.'
  }
];

export const MCP_POLICY_CONTRACTS = {
  toolAllowlist: {
    version: '1.0',
    policyName: 'agent-tool-rbac',
    description: 'Role-Based Tool Authorization for Autonomous AI Agents',
    roles: {
      'support-agent': {
        allowedTools: [
          'search_knowledge_base',
          'get_order_status',
          'calculate_refund_estimate'
        ],
        deniedTools: [
          'execute_database_sql',
          'modify_iam_policy',
          'transfer_funds',
          'issue_privileged_refund',
          'audit_and_release_credit_hold',
          'execute_erp_refund'
        ]
      },
      'erp-operator': {
        allowedTools: [
          'search_knowledge_base',
          'get_order_status',
          'create_service_ticket',
          'issue_privileged_refund',
          'audit_and_release_credit_hold'
        ],
        deniedTools: [
          'execute_database_sql',
          'modify_iam_policy',
          'transfer_funds'
        ]
      }
    }
  },
  dlpClassification: {
    version: '1.0',
    policyName: 'agent-dlp-rules',
    description: 'Data Loss Prevention (DLP) inspection rules for agent inputs and tool outputs',
    rules: [
      {
        id: 'DLP-001',
        name: 'Credit Card Number',
        pattern: '\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\\b',
        action: 'REDACT',
        replacement: '[REDACTED_CREDIT_CARD]'
      },
      {
        id: 'DLP-002',
        name: 'Social Security Number (SSN)',
        pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b',
        action: 'REDACT',
        replacement: '[REDACTED_SSN]'
      },
      {
        id: 'DLP-003',
        name: 'API Bearer Token / Secret Key',
        pattern: '(?i)[\'"]?(?:api_key|token|bearer|secret)[\'"]?\\s*[:=]\\s*[\'"]?([a-zA-Z0-9_\\-\\.]{16,})',
        action: 'BLOCK',
        message: 'Outbound execution blocked: raw credentials detected in payload'
      }
    ]
  },
  hitlThresholds: {
    version: '1.0',
    policyName: 'human-in-the-loop-thresholds',
    description: 'Risk-based Human-in-the-Loop (HITL) escalation gates',
    rules: [
      {
        id: 'HITL-001',
        targetTool: 'issue_privileged_refund',
        condition: 'amount > 200.00',
        action: 'REQUIRE_HUMAN_APPROVAL',
        escalationChannel: 'servicenow-approval-queue',
        approverRole: 'finance-manager'
      },
      {
        id: 'HITL-002',
        targetTool: 'delete_customer_record',
        condition: 'always',
        action: 'REQUIRE_HUMAN_APPROVAL',
        escalationChannel: 'privacy-officer-queue',
        approverRole: 'dpo'
      }
    ]
  }
};

export const TERRAFORM_CONTRACT_SNIPPETS: {
  oidcTrustHcl: string;
  exportEnvScript: string;
  cloudflarePlatformSpec: string;
  weeklyResetWorkflowYaml: string;
} = {
  oidcTrustHcl: `# modules/aws-gcp-oidc-trust/main.tf
# Establishes cryptographic trust between Google Cloud Platform (GCP) and AWS IAM.
# Allows a specific GCP Service Account to assume an AWS IAM role via STS AssumeRoleWithWebIdentity.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

# AWS IAM OIDC Identity Provider for Google Accounts
# Note: Google's OIDC issuer URL is https://accounts.google.com
resource "aws_iam_openid_connect_provider" "google_oidc" {
  count           = var.create_oidc_provider ? 1 : 0
  url             = "https://accounts.google.com"
  client_id_list  = [var.gcp_client_id]
  thumbprint_list = var.google_oidc_thumbprints
}

locals {
  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.google_oidc[0].arn : var.existing_oidc_provider_arn
}

# IAM Trust Policy allowing GCP Service Account to assume role
data "aws_iam_policy_document" "assume_role_with_web_identity" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "accounts.google.com:sub"
      values   = [var.gcp_service_account_unique_id]
    }

    condition {
      test     = "StringEquals"
      variable = "accounts.google.com:aud"
      values   = [var.gcp_client_id]
    }
  }
}

# AWS IAM Role for Cross-Cloud Execution
resource "aws_iam_role" "cross_cloud_agent_role" {
  name                 = var.role_name
  assume_role_policy   = data.aws_iam_policy_document.assume_role_with_web_identity.json
  max_session_duration = var.max_session_duration_seconds

  tags = merge(
    var.tags,
    {
      "SecurityPosture"  = "ZeroTrust"
      "FederationSource" = "GCP-VertexAI"
      "ManagedBy"        = "Terraform"
    }
  )
}`,
  exportEnvScript: `#!/usr/bin/env bash
# stacks/showcase/cross-cloud-agent-identity/export-env.sh
# Generates the .env file contract for cross-cloud-agent-identity from Terraform outputs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
TARGET_ENV="\${1:-\${SCRIPT_DIR}/../../../../cross-cloud-agent-identity/poc/.env}"

echo "Extracting Terraform state outputs from \${SCRIPT_DIR}..."

if ! terraform output -json > /dev/null 2>&1; then
  echo "Error: No Terraform state found. Please run 'terraform apply' first." >&2
  exit 1
fi

TF_OUTPUT=$(terraform output -json)

GCP_PROJECT_ID=$(echo "\${TF_OUTPUT}" | jq -r '.gcp_project_id.value // ""')
GCP_LOCATION=$(echo "\${TF_OUTPUT}" | jq -r '.gcp_location.value // "us-central1"')
AWS_REGION=$(echo "\${TF_OUTPUT}" | jq -r '.aws_region.value // "us-east-1"')
AWS_ROLE_ARN=$(echo "\${TF_OUTPUT}" | jq -r '.aws_federated_role_arn.value // ""')
FRONTDOOR_SA=$(echo "\${TF_OUTPUT}" | jq -r '.frontdoor_service_account.value // ""')
AGENT_SA=$(echo "\${TF_OUTPUT}" | jq -r '.agent_service_account.value // ""')

cat <<EOF > "\${TARGET_ENV}"
# =============================================================================
# Generated automatically by managed-infrastructure
# Stack: stacks/showcase/cross-cloud-agent-identity
# =============================================================================

# Google Cloud Configuration
GCP_PROJECT_ID=\${GCP_PROJECT_ID}
GCP_LOCATION=\${GCP_LOCATION}
FRONTDOOR_SA=\${FRONTDOOR_SA}
AGENT_SA=\${AGENT_SA}

# AWS Configuration
AWS_REGION=\${AWS_REGION}
AWS_ROLE_ARN=\${AWS_ROLE_ARN}
EOF

echo "✓ Successfully exported environment contract to: \${TARGET_ENV}"`,
  cloudflarePlatformSpec: `# stacks/platform/0trust-cloudflare/main.tf
# Provisions 0trust.dev Cloudflare Pages control plane, D1 SQLite state store, and Sunday 00:00 UTC Cron reset trigger.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.40"
    }
  }
}

resource "cloudflare_d1_database" "agentic_state_db" {
  account_id = var.cloudflare_account_id
  name       = "0trust-agentic-state-db"
}

resource "cloudflare_pages_project" "zero_trust_portal" {
  account_id        = var.cloudflare_account_id
  name              = "0trust-dev-portfolio"
  production_branch = "main"

  build_config {
    build_command   = "npm run build"
    destination_dir = "dist"
  }

  deployment_configs {
    production {
      d1_databases = {
        STATE_DB = cloudflare_d1_database.agentic_state_db.id
      }
      environment_variables = {
        ENVIRONMENT          = "production"
        CANONICAL_RESET_CRON = "0 0 * * 0"
      }
    }
  }
}

resource "cloudflare_worker_cron_trigger" "weekly_canonical_reset" {
  account_id  = var.cloudflare_account_id
  script_name = "0trust-canonical-reset-worker"
  schedules   = ["0 0 * * 0"] # Every Sunday at 00:00 UTC
}`,
  weeklyResetWorkflowYaml: `name: Weekly Canonical State Reset (0trust.dev)

on:
  schedule:
    - cron: '0 0 * * 0' # Every Sunday at 00:00 UTC
  workflow_dispatch:
    inputs:
      reason:
        description: 'Reset trigger reason'
        required: false
        default: 'WEEKLY_CRON_RESET'

permissions:
  id-token: write
  contents: read

jobs:
  reset-canonical-seed:
    name: Re-Seed D1 & ServiceNow Order-to-Cash Tables
    runs-on: ubuntu-latest
    steps:
      - name: Checkout managed-infrastructure
        uses: actions/checkout@v4

      - name: Re-seed Cloudflare D1 & ServiceNow x_ent_erp_ovl Canonical Records
        env:
          CF_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          SN_INSTANCE_URL: \${{ secrets.SERVICENOW_INSTANCE_URL }}
          SN_CALLBACK_SECRET: \${{ secrets.SN_AGENT_CALLBACK_TOKEN }}
        run: |
          echo "Resetting ORD-1042 (Acme Global Corp, $145,000) to BLOCKED..."
          echo "Purging ephemeral sys_audit and telemetry logs older than 7 days..."
          echo "✓ Canonical Zero-Drift state restored at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"`
};

export const CANONICAL_SEED_ERP_RECORDS: ErpExceptionRecord[] = [
  {
    sys_id: '8f2a9c41d7102200a9ad1e173e24d401',
    order_id: 'ORD-1042',
    customer_id: 'CUST-ACME-001',
    customer_name: 'Acme Global Corp',
    process: 'credit',
    amount_usd: 145000,
    credit_limit_usd: 100000,
    current_exposure_usd: 88000,
    risk_tier: 'MEDIUM',
    days_past_due: 4,
    current_status: 'BLOCKED',
    correlation_id: 'corr_89b4f1a2_ord1042',
    aws_request_id: 'pending_invocation',
    ai_justification:
      'Awaiting agentic credit audit. Order value ($145,000) exceeds standard auto-approval threshold ($200) and pushes aggregate exposure beyond $100,000 baseline credit limit.',
    updated_at: '2026-11-17T08:15:00Z',
    updated_by: 'system.sap_ecc_sync'
  },
  {
    sys_id: '7c190b22d7102200a9ad1e173e24d409',
    order_id: 'ORD-1049',
    customer_id: 'CUST-NOVA-019',
    customer_name: 'Nova Biotech Labs',
    process: 'credit',
    amount_usd: 180,
    credit_limit_usd: 50000,
    current_exposure_usd: 12400,
    risk_tier: 'LOW',
    days_past_due: 0,
    current_status: 'BLOCKED',
    correlation_id: 'corr_41e9a0c3_ord1049',
    aws_request_id: 'pending_invocation',
    ai_justification:
      'Low-dollar tax/shipping credit memo ($180.00 <= $200.00 HITL threshold). Eligible for deterministic MCP auto-approval under HITL-001 policy.',
    updated_at: '2026-11-17T09:05:00Z',
    updated_by: 'system.sap_ecc_sync'
  },
  {
    sys_id: '3d841a90d7102200a9ad1e173e24d412',
    order_id: 'ORD-2015',
    customer_id: 'CUST-HELIOS-084',
    customer_name: 'Helios Aerospace Systems',
    process: 'order',
    amount_usd: 62000,
    credit_limit_usd: 150000,
    current_exposure_usd: 45000,
    risk_tier: 'LOW',
    days_past_due: 0,
    current_status: 'BLOCKED',
    correlation_id: 'corr_52f1b7d4_ord2015',
    aws_request_id: 'pending_invocation',
    ai_justification:
      'EDI 850 purchase order BOM SKU validation hold: export control classification ECCN 9A991 requires compliance cross-check.',
    updated_at: '2026-11-17T10:22:00Z',
    updated_by: 'system.edi_gateway'
  },
  {
    sys_id: '9a552e11d7102200a9ad1e173e24d418',
    order_id: 'ORD-3088',
    customer_id: 'CUST-KRONOS-204',
    customer_name: 'Kronos Semiconductor GmbH',
    process: 'fulfillment',
    amount_usd: 94000,
    credit_limit_usd: 200000,
    current_exposure_usd: 112000,
    risk_tier: 'MEDIUM',
    days_past_due: 2,
    current_status: 'BLOCKED',
    correlation_id: 'corr_63c8d2e5_ord3088',
    aws_request_id: 'pending_invocation',
    ai_justification:
      'Cold-chain 3PL warehouse allocation split across Frankfurt and Rotterdam hubs requires carrier SLA re-verification before pick-release.',
    updated_at: '2026-11-17T11:40:00Z',
    updated_by: 'system.wms_connector'
  },
  {
    sys_id: '1e773f33d7102200a9ad1e173e24d425',
    order_id: 'ORD-4012',
    customer_id: 'CUST-VANGUARD-311',
    customer_name: 'Vanguard MedTech Partners',
    process: 'invoice',
    amount_usd: 31500,
    credit_limit_usd: 90000,
    current_exposure_usd: 29000,
    risk_tier: 'LOW',
    days_past_due: 0,
    current_status: 'BLOCKED',
    correlation_id: 'corr_74d9e3f6_ord4012',
    aws_request_id: 'pending_invocation',
    ai_justification:
      'Three-way match variance (+1.8% freight surcharge between PO, Goods Receipt, and Electronic Invoice) flagged for billing review.',
    updated_at: '2026-11-17T13:10:00Z',
    updated_by: 'system.ap_ar_engine'
  },
  {
    sys_id: '5b994a55d7102200a9ad1e173e24d439',
    order_id: 'ORD-5004',
    customer_id: 'CUST-APEX-509',
    customer_name: 'Apex Sovereign Energy Ltd',
    process: 'cash',
    amount_usd: 210000,
    credit_limit_usd: 250000,
    current_exposure_usd: 195000,
    risk_tier: 'HIGH',
    days_past_due: 11,
    current_status: 'BLOCKED',
    correlation_id: 'corr_85eaf407_ord5004',
    aws_request_id: 'pending_invocation',
    ai_justification:
      'ISO 20022 SWIFT MT103 wire remittance ($210,000) partial reference mismatch across two open invoices; requires cash application reconciliation.',
    updated_at: '2026-11-17T14:55:00Z',
    updated_by: 'system.treasury_swift'
  }
];
