export interface LlmMessage { role: 'system' | 'user' | 'assistant'; content: string; }
export interface LlmOptions { baseUrl: string; apiKey: string; model: string; }

export class OpenAICompatibleLLM {
  constructor(private readonly options: LlmOptions) {}

  async chat(messages: LlmMessage[], tools?: unknown[]): Promise<string> {
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
      body: JSON.stringify({ model: this.options.model, messages, ...(tools ? { tools } : {}) })
    });
    if (!response.ok) throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
    const data = await response.json() as any;
    return data?.choices?.[0]?.message?.content ?? '';
  }
}
