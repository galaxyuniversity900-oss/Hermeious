# Hermeious

**Additional power for AI weakness.**

Hermeious is a **capability runtime**, not a model aggregator. Any compatible LLM can act as the reasoning layer while Hermeious supplies capabilities the model does not natively provide.

```text
ANY LLM
   ↓
Intent / Planner
   ↓
Capability Registry → Policy Engine
   ↓
Capability Router / Executor
   ↓
MCP / HTTP APIs / Local Sandboxed Tools
   ↓
Validator / Memory
```

## Implemented

### Phase 1 — Runtime foundation
- Provider-neutral capability manifests and registry
- Risk-aware policy/approval gate
- OpenAI-compatible LLM adapter, suitable for DeepSeek and other compatible endpoints
- Safe built-in `system.echo`
- Explicit-approval `file.metadata`
- HTTP API for health, discovery and capability execution

### Phase 2 — Tool extension layer
- Deterministic capability router based on IDs, descriptions and tags
- LLM-backed JSON capability planner
- MCP HTTP client with initialize, tool discovery and tool execution
- MCP tools are converted into Hermeious capabilities after an explicit `/mcp/connect` request
- MCP server host allowlist to reduce SSRF risk
- Manifest-only capability discovery with validation; no arbitrary code is auto-installed
- Policy-aware multi-step plan executor
- CI build and unit-test workflow

## API

- `GET /health` — runtime status
- `GET /capabilities` — registered capabilities
- `GET /route?goal=...` — deterministic capability candidates
- `POST /plan` — ask the configured LLM to produce a capability plan
- `POST /execute-plan` — execute a plan through the policy engine
- `POST /capabilities/execute` — execute one capability
- `POST /mcp/connect` — explicitly connect an allowed MCP HTTP server and register its tools
- `GET /mcp/servers` — connected MCP server names

Example:

```json
{"capability":"system.echo","input":{"message":"hello"}}
```

For medium/high/critical capabilities, send `"approved": true` only when the caller has explicitly authorized the operation. Plan execution applies the same rule to every step.

## Configuration

Copy `.env.example` and configure:

```text
PORT=8787
MAX_RISK=medium
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=replace_me
LLM_MODEL=deepseek-chat
MCP_ALLOWED_HOSTS=localhost,127.0.0.1
```

LLM credentials are never committed to the repository. The runtime must not expose arbitrary host shell execution to an LLM; future code execution belongs behind a sandbox and policy layer.

## Architecture direction

The runtime is intentionally provider-neutral:

```text
             ANY LLM
                ↓
        Capability Planner
                ↓
       Capability Router
                ↓
        Capability Registry
          ↙      ↓       ↘
        MCP     HTTP     LOCAL
         ↓       ↓         ↓
      Browser   Video    Files
      Search    Image    FFmpeg
      GitHub    Voice    Blender
                ↓
          Policy / Approval
                ↓
            Executor
                ↓
        Validator / Memory
```

## Roadmap

1. ~~MCP client / registry adapter~~
2. ~~Capability routing and LLM planning~~
3. Signed capability manifests and stronger discovery trust model
4. Provider resolver and fallback routing
5. Composite capability planner with dependency-aware execution
6. Memory and provider-performance history
7. Sandboxed code/browser/media/file execution
8. Web console and universal API
9. Capability marketplace
