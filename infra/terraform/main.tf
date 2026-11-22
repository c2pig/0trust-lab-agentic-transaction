provider "cloudflare" {}

module "cloudflare_pages_lab" {
  source = "git::https://github.com/c2pig/managed-infrastructure.git//modules/cloudflare-pages-lab?ref=main"

  cloudflare_account_id = var.cloudflare_account_id
  cloudflare_zone_id    = var.cloudflare_zone_id
  state_kv_namespace_id = var.state_kv_namespace_id

  pages_project_name = "0trust-lab-agentic-transaction"
  subdomain_prefix   = "lab-agentic-transaction"

  plain_env_vars = {
    ENVIRONMENT = "production"
  }

  secret_env_vars = var.sn_agent_callback_token != "" ? {
    SN_AGENT_CALLBACK_TOKEN = var.sn_agent_callback_token
  } : {}
}
