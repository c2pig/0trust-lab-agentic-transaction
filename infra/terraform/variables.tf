variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare Account ID (from stacks/global/cloudflare/platform)."
}

variable "cloudflare_zone_id" {
  type        = string
  description = "Cloudflare Zone ID for 0trust.dev (from stacks/global/cloudflare/platform)."
}

variable "state_kv_namespace_id" {
  type        = string
  description = "Shared STATE_KV namespace ID (from stacks/global/cloudflare/platform)."
}

variable "sn_agent_callback_token" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Optional ServiceNow HITL callback signing token (SN_AGENT_CALLBACK_TOKEN)."
}
