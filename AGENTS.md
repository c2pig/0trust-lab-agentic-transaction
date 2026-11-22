# Agent & Contributor Instructions (`0trust-lab-agentic-transaction`)

## Two-Way Global <-> Local Architecture Diagram Sync

This standalone Model 1 repository powers **Lab 2 (`Controlled AI Financial Actions` / `/agentic-transaction`)** on [`0trust.dev`](https://github.com/c2pig/0trust.dev/blob/main/docs/ECOSYSTEM_MAP.md) (`https://agentic-transaction.lab.0trust.dev`).

Whenever you modify code, edge functions, or Terraform infrastructure under `src/`, `functions/`, or `infra/`:

1. **Local Sync**: Update [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) in the same Pull Request (enforced by [`.github/workflows/diagram-check.yml`](.github/workflows/diagram-check.yml)).
2. **Global Sync**: If public contracts, seat descriptors, API endpoints, KV prefixes, or OBO/MCP/ServiceNow HITL boundaries change, also update `lab.manifest.json`, `src/contracts/labManifest.ts`, `docs/ARCHITECTURE.md`, and `docs/diagrams/platform_capability_zoomin.svg` in [`c2pig/0trust.dev`](https://github.com/c2pig/0trust.dev).
