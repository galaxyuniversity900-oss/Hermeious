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

## Implemented foundation

- Provider-neutral capability manifests and registry
- Risk-aware policy/approval gate
- OpenAI-compatible LLM adapter, suitable for DeepSeek and other compatible endpoints
- Safe built-in `system.echo`
- Explicit-approval `file.metadata`
- HTTP API for health, discovery and capability execution
- Extension points for MCP, API providers, sandboxed execution and composite capabilities

## API

- `GET /health`
- `GET /capabilities`
- `POST /capabilities/execute`

Example body:

```json
{"capability":"system.echo","input":{"message":"hello"}}
```

For medium/high/critical capabilities, send `"approved": true` only when the caller has explicitly authorized the operation.

## Configuration

```text
PORT=8787
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=replace_me
LLM_MODEL=deepseek-chat
```

LLM credentials are never committed to the repository. The runtime must not expose arbitrary host shell execution to an LLM; future code execution belongs behind a sandbox and policy layer.

## Roadmap

1. MCP client/registry adapter
2. Dynamic capability discovery with signed manifests and allowlists
3. Provider resolver and fallback routing
4. Composite capability planner
5. Memory and provider-performance history
6. Sandboxed code/browser/media/file execution
7. Web console and universal API
8. Capability marketplace
