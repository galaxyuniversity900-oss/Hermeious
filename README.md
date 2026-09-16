# Hermeious

**Additional power for AI weakness.**

Hermeious is a capability runtime: any LLM can plan work and invoke external capabilities through a controlled execution layer. It is not a model aggregator.

## Architecture

`ANY LLM → Intent/Planner → Capability Registry → Router → Executor → Validator → Memory`

The foundation is provider-neutral and designed for MCP, HTTP APIs, local tools, sandboxed code, files, browser automation, media generation, databases, and composite workflows.

## Phase 1

- OpenAI-compatible LLM adapter (works with DeepSeek and other compatible endpoints)
- Capability manifest + registry
- Policy/risk gate
- Deterministic capability routing
- Safe built-in `system.echo` and `file.metadata` capabilities
- HTTP API
- Clear extension points for MCP/API/local providers

## Run

```bash
npm install
npm run build
npm start
```

Environment:

```text
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=your_key
LLM_MODEL=deepseek-chat
PORT=8787
```

The runtime never gives the LLM arbitrary host shell access. High-risk capabilities must pass policy/approval gates and should execute inside a sandbox.
