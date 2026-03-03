# Building a Multi-Provider LLM Abstraction Layer

A production-ready guide to creating a unified interface across OpenAI, Anthropic, Azure OpenAI, Google Gemini, and local models.

---

## Table of Contents

1. [Why Abstract LLM Providers?](#why-abstract-llm-providers)
2. [Core Interface Design](#core-interface-design)
3. [Provider Implementations](#provider-implementations)
   - [OpenAI](#1-openai)
   - [Anthropic](#2-anthropic)
   - [Azure OpenAI](#3-azure-openai)
   - [Google Gemini](#4-google-gemini)
   - [Local Models (Ollama)](#5-local-models-ollama)
4. [Streaming Responses](#streaming-responses)
5. [Tool/Function Calling Normalization](#tool-function-calling-normalization)
6. [Cost Tracking](#cost-tracking)
7. [Fallback Chains](#fallback-chains)
8. [Complete Example](#complete-example)

---

## Why Abstract LLM Providers?

**Benefits:**
- **Vendor independence** - Switch providers without changing application code
- **Resilience** - Automatic failover when a provider is down
- **Cost optimization** - Route requests to cheapest provider for task
- **A/B testing** - Compare provider performance easily
- **Future-proofing** - Add new providers without refactoring

---

## Core Interface Design

### Base Types

```typescript
// types.ts
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface CompletionRequest {
  messages: Message[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  stream?: boolean;
}

export interface CompletionResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
  cost?: number;
}

export interface StreamChunk {
  delta: string;
  toolCalls?: Partial<ToolCall>[];
  finishReason?: CompletionResponse['finishReason'];
}

export interface LLMProvider {
  name: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): AsyncGenerator<StreamChunk>;
  listModels(): Promise<string[]>;
  estimateCost(request: CompletionRequest, response: CompletionResponse): number;
}
```

---

## Provider Implementations

### 1. OpenAI

```typescript
// providers/openai.ts
import OpenAI from 'openai';
import type { LLMProvider, CompletionRequest, CompletionResponse, StreamChunk } from '../types';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const response = await this.client.chat.completions.create({
      model: request.model,
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        ...(msg.name && { name: msg.name }),
        ...(msg.toolCallId && { tool_call_id: msg.toolCallId }),
      })),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      tools: request.tools?.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      stream: false,
    });

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      content: choice.message.content || '',
      toolCalls,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      model: response.model,
      provider: this.name,
      cost: this.estimateCost(request, response),
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: request.model,
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      tools: request.tools?.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      
      yield {
        delta: delta?.content || '',
        toolCalls: delta?.tool_calls?.map(tc => ({
          id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : undefined,
        })),
        finishReason: chunk.choices[0]?.finish_reason 
          ? this.mapFinishReason(chunk.choices[0].finish_reason)
          : undefined,
      };
    }
  }

  async listModels(): Promise<string[]> {
    const models = await this.client.models.list();
    return models.data
      .filter(m => m.id.startsWith('gpt-'))
      .map(m => m.id);
  }

  estimateCost(request: CompletionRequest, response: any): number {
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 2.50, output: 10.00 },
      'gpt-4o-mini': { input: 0.15, output: 0.60 },
      'gpt-4-turbo': { input: 10.00, output: 30.00 },
      'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
    };

    const modelKey = Object.keys(pricing).find(k => response.model?.startsWith(k));
    if (!modelKey) return 0;

    const rates = pricing[modelKey];
    const inputCost = (response.usage.prompt_tokens / 1_000_000) * rates.input;
    const outputCost = (response.usage.completion_tokens / 1_000_000) * rates.output;
    
    return inputCost + outputCost;
  }

  private mapFinishReason(reason: string): CompletionResponse['finishReason'] {
    const map: Record<string, CompletionResponse['finishReason']> = {
      'stop': 'stop',
      'length': 'length',
      'tool_calls': 'tool_calls',
      'content_filter': 'content_filter',
    };
    return map[reason] || 'stop';
  }
}
```

---

### 2. Anthropic

```typescript
// providers/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, CompletionRequest, CompletionResponse, StreamChunk } from '../types';

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    // Extract system messages
    const systemMessages = request.messages.filter(m => m.role === 'system');
    const conversationMessages = request.messages.filter(m => m.role !== 'system');

    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature,
      system: systemMessages.map(m => m.content).join('\n'),
      messages: conversationMessages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      })),
      tools: request.tools?.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
    });

    const textContent = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as any).text)
      .join('');

    const toolCalls = response.content
      .filter(block => block.type === 'tool_use')
      .map(block => ({
        id: (block as any).id,
        name: (block as any).name,
        arguments: (block as any).input,
      }));

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      model: response.model,
      provider: this.name,
      cost: this.estimateCost(request, response),
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const systemMessages = request.messages.filter(m => m.role === 'system');
    const conversationMessages = request.messages.filter(m => m.role !== 'system');

    const stream = await this.client.messages.stream({
      model: request.model,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature,
      system: systemMessages.map(m => m.content).join('\n'),
      messages: conversationMessages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      })),
      tools: request.tools?.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { delta: event.delta.text };
        } else if (event.delta.type === 'input_json_delta') {
          // Tool use streaming
          yield { delta: '' };
        }
      } else if (event.type === 'message_stop') {
        yield { delta: '', finishReason: 'stop' };
      }
    }
  }

  async listModels(): Promise<string[]> {
    // Anthropic doesn't have a models endpoint; return known models
    return [
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ];
  }

  estimateCost(request: CompletionRequest, response: any): number {
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-opus-4': { input: 15.00, output: 75.00 },
      'claude-sonnet-4': { input: 3.00, output: 15.00 },
      'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
      'claude-3-5-haiku': { input: 0.80, output: 4.00 },
      'claude-3-opus': { input: 15.00, output: 75.00 },
    };

    const modelKey = Object.keys(pricing).find(k => response.model?.includes(k));
    if (!modelKey) return 0;

    const rates = pricing[modelKey];
    const inputCost = (response.usage.input_tokens / 1_000_000) * rates.input;
    const outputCost = (response.usage.output_tokens / 1_000_000) * rates.output;
    
    return inputCost + outputCost;
  }
}
```

---

### 3. Azure OpenAI

```typescript
// providers/azure-openai.ts
import { OpenAIClient, AzureKeyCredential } from '@azure/openai';
import type { LLMProvider, CompletionRequest, CompletionResponse, StreamChunk } from '../types';

export class AzureOpenAIProvider implements LLMProvider {
  name = 'azure-openai';
  private client: OpenAIClient;
  private deploymentMap: Map<string, string>; // model -> deployment name

  constructor(endpoint: string, apiKey: string, deploymentMap: Record<string, string> = {}) {
    this.client = new OpenAIClient(endpoint, new AzureKeyCredential(apiKey));
    this.deploymentMap = new Map(Object.entries(deploymentMap));
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const deployment = this.deploymentMap.get(request.model) || request.model;

    const response = await this.client.getChatCompletions(
      deployment,
      request.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        ...(msg.name && { name: msg.name }),
      })),
      {
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        tools: request.tools?.map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
      }
    );

    const choice = response.choices[0];
    const toolCalls = choice.message?.toolCalls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      content: choice.message?.content || '',
      toolCalls,
      finishReason: choice.finishReason === 'tool_calls' ? 'tool_calls' : 'stop',
      usage: {
        promptTokens: response.usage?.promptTokens || 0,
        completionTokens: response.usage?.completionTokens || 0,
        totalTokens: response.usage?.totalTokens || 0,
      },
      model: request.model,
      provider: this.name,
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const deployment = this.deploymentMap.get(request.model) || request.model;

    const events = await this.client.streamChatCompletions(
      deployment,
      request.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      {
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      }
    );

    for await (const event of events) {
      const delta = event.choices[0]?.delta;
      
      yield {
        delta: delta?.content || '',
        finishReason: event.choices[0]?.finishReason 
          ? (event.choices[0].finishReason === 'stop' ? 'stop' : 'length')
          : undefined,
      };
    }
  }

  async listModels(): Promise<string[]> {
    // Azure OpenAI uses deployments; return configured models
    return Array.from(this.deploymentMap.keys());
  }

  estimateCost(request: CompletionRequest, response: CompletionResponse): number {
    // Azure pricing varies by deployment and region
    // Use same pricing as OpenAI as baseline
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 2.50, output: 10.00 },
      'gpt-4-turbo': { input: 10.00, output: 30.00 },
      'gpt-35-turbo': { input: 0.50, output: 1.50 },
    };

    const modelKey = Object.keys(pricing).find(k => request.model.includes(k));
    if (!modelKey) return 0;

    const rates = pricing[modelKey];
    const inputCost = (response.usage.promptTokens / 1_000_000) * rates.input;
    const outputCost = (response.usage.completionTokens / 1_000_000) * rates.output;
    
    return inputCost + outputCost;
  }
}
```

---

### 4. Google Gemini

```typescript
// providers/gemini.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { LLMProvider, CompletionRequest, CompletionResponse, StreamChunk } from '../types';

export class GeminiProvider implements LLMProvider {
  name = 'gemini';
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = this.client.getGenerativeModel({ model: request.model });

    // Gemini uses different message format
    const contents = this.formatMessages(request.messages);
    
    const result = await model.generateContent({
      contents,
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
      },
      tools: request.tools ? [{
        functionDeclarations: request.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      }] : undefined,
    });

    const response = result.response;
    const text = response.text();
    
    // Extract function calls if present
    const functionCalls = response.functionCalls?.()?.map(fc => ({
      id: `call_${Date.now()}`,
      name: fc.name,
      arguments: fc.args,
    }));

    return {
      content: text,
      toolCalls: functionCalls,
      finishReason: functionCalls ? 'tool_calls' : 'stop',
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0,
      },
      model: request.model,
      provider: this.name,
      cost: this.estimateCost(request, response),
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const model = this.client.getGenerativeModel({ model: request.model });
    const contents = this.formatMessages(request.messages);
    
    const result = await model.generateContentStream({
      contents,
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
      },
    });

    for await (const chunk of result.stream) {
      const text = chunk.text();
      yield {
        delta: text,
        finishReason: undefined,
      };
    }

    yield { delta: '', finishReason: 'stop' };
  }

  async listModels(): Promise<string[]> {
    return [
      'gemini-2.0-flash-exp',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-1.0-pro',
    ];
  }

  estimateCost(request: CompletionRequest, response: any): number {
    const pricing: Record<string, { input: number; output: number }> = {
      'gemini-2.0-flash': { input: 0.075, output: 0.30 },
      'gemini-1.5-pro': { input: 1.25, output: 5.00 },
      'gemini-1.5-flash': { input: 0.075, output: 0.30 },
      'gemini-1.0-pro': { input: 0.50, output: 1.50 },
    };

    const modelKey = Object.keys(pricing).find(k => request.model.includes(k));
    if (!modelKey) return 0;

    const rates = pricing[modelKey];
    const inputCost = ((response.usageMetadata?.promptTokenCount || 0) / 1_000_000) * rates.input;
    const outputCost = ((response.usageMetadata?.candidatesTokenCount || 0) / 1_000_000) * rates.output;
    
    return inputCost + outputCost;
  }

  private formatMessages(messages: any[]) {
    // Gemini requires alternating user/model messages
    const contents: any[] = [];
    let currentRole: string | null = null;
    let currentParts: any[] = [];

    for (const msg of messages) {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      
      if (role !== currentRole && currentParts.length > 0) {
        contents.push({ role: currentRole, parts: currentParts });
        currentParts = [];
      }

      currentRole = role;
      currentParts.push({ text: msg.content });
    }

    if (currentParts.length > 0) {
      contents.push({ role: currentRole, parts: currentParts });
    }

    return contents;
  }
}
```

---

### 5. Local Models (Ollama)

```typescript
// providers/ollama.ts
import type { LLMProvider, CompletionRequest, CompletionResponse, StreamChunk } from '../types';

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens,
        },
        stream: false,
        tools: request.tools,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      content: data.message.content,
      toolCalls: data.message.tool_calls?.map((tc: any, i: number) => ({
        id: `call_${i}`,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      finishReason: data.message.tool_calls ? 'tool_calls' : 'stop',
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      model: request.model,
      provider: this.name,
      cost: 0, // Local models are free!
    };
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamChunk> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens,
        },
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        
        const data = JSON.parse(line);
        
        yield {
          delta: data.message?.content || '',
          finishReason: data.done ? 'stop' : undefined,
        };
      }
    }
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    const data = await response.json();
    return data.models.map((m: any) => m.name);
  }

  estimateCost(): number {
    return 0; // Local models are free
  }
}
```

---

## Streaming Responses

### Unified Streaming Handler

```typescript
// streaming.ts
import type { LLMProvider, CompletionRequest, StreamChunk } from './types';

export class StreamingHandler {
  constructor(private provider: LLMProvider) {}

  async *stream(request: CompletionRequest): AsyncGenerator<string> {
    let fullContent = '';
    
    for await (const chunk of this.provider.stream(request)) {
      if (chunk.delta) {
        fullContent += chunk.delta;
        yield chunk.delta;
      }

      if (chunk.finishReason) {
        break;
      }
    }
  }

  // Stream with accumulation
  async streamWithCallback(
    request: CompletionRequest,
    onChunk: (delta: string, accumulated: string) => void,
    onComplete?: (full: string) => void
  ): Promise<void> {
    let accumulated = '';

    for await (const chunk of this.provider.stream(request)) {
      if (chunk.delta) {
        accumulated += chunk.delta;
        onChunk(chunk.delta, accumulated);
      }

      if (chunk.finishReason) {
        onComplete?.(accumulated);
        break;
      }
    }
  }

  // Server-Sent Events (SSE) format
  async *streamSSE(request: CompletionRequest): AsyncGenerator<string> {
    for await (const chunk of this.provider.stream(request)) {
      if (chunk.delta) {
        yield `data: ${JSON.stringify({ type: 'chunk', content: chunk.delta })}\n\n`;
      }

      if (chunk.finishReason) {
        yield `data: ${JSON.stringify({ type: 'done', reason: chunk.finishReason })}\n\n`;
        yield 'data: [DONE]\n\n';
        break;
      }
    }
  }
}

// Usage example
async function streamExample() {
  const provider = new OpenAIProvider('sk-...');
  const handler = new StreamingHandler(provider);

  await handler.streamWithCallback(
    {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Write a haiku about TypeScript' }],
    },
    (delta, accumulated) => {
      process.stdout.write(delta); // Print each chunk
    },
    (full) => {
      console.log('\n\nFinal:', full);
    }
  );
}
```

---

## Tool/Function Calling Normalization

### Universal Tool Format

```typescript
// tools.ts
import type { ToolDefinition, ToolCall, Message, CompletionRequest, CompletionResponse } from './types';

export interface ToolHandler {
  name: string;
  description: string;
  parameters: ToolDefinition['parameters'];
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolHandler>();

  register(tool: ToolHandler): void {
    this.tools.set(tool.name, tool);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  async execute(toolCall: ToolCall): Promise<unknown> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      throw new Error(`Tool not found: ${toolCall.name}`);
    }
    return tool.execute(toolCall.arguments);
  }

  // Normalize tool calls across providers
  normalizeToolCalls(response: CompletionResponse): ToolCall[] {
    if (!response.toolCalls) return [];

    return response.toolCalls.map(tc => ({
      id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: tc.name,
      arguments: tc.arguments,
    }));
  }

  // Create tool result message
  createToolResultMessage(toolCallId: string, result: unknown): Message {
    return {
      role: 'tool',
      content: typeof result === 'string' ? result : JSON.stringify(result),
      toolCallId,
    };
  }
}

// Example tools
export const weatherTool: ToolHandler = {
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name or coordinates' },
      units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
    },
    required: ['location'],
  },
  async execute(args) {
    // Mock implementation
    return {
      location: args.location,
      temperature: 72,
      condition: 'sunny',
      units: args.units || 'fahrenheit',
    };
  },
};

export const calculatorTool: ToolHandler = {
  name: 'calculate',
  description: 'Perform mathematical calculations',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'Mathematical expression to evaluate' },
    },
    required: ['expression'],
  },
  async execute(args) {
    // UNSAFE: Don't use eval in production! Use a proper math parser
    try {
      return { result: eval(args.expression as string) };
    } catch (error) {
      return { error: 'Invalid expression' };
    }
  },
};

// Tool execution loop
export async function executeToolLoop(
  provider: any,
  request: CompletionRequest,
  registry: ToolRegistry,
  maxIterations = 5
): Promise<CompletionResponse> {
  let messages = [...request.messages];
  let iterations = 0;

  while (iterations < maxIterations) {
    const response = await provider.complete({
      ...request,
      messages,
      tools: registry.getDefinitions(),
    });

    if (!response.toolCalls || response.toolCalls.length === 0) {
      return response; // No more tool calls, we're done
    }

    // Add assistant's response with tool calls
    messages.push({
      role: 'assistant',
      content: response.content,
    });

    // Execute all tool calls
    for (const toolCall of response.toolCalls) {
      const result = await registry.execute(toolCall);
      messages.push(registry.createToolResultMessage(toolCall.id, result));
    }

    iterations++;
  }

  throw new Error('Max tool iterations exceeded');
}
```

---

## Cost Tracking

### Cost Tracker Implementation

```typescript
// cost-tracking.ts
import type { CompletionRequest, CompletionResponse } from './types';

export interface CostEntry {
  timestamp: Date;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  requestId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export class CostTracker {
  private entries: CostEntry[] = [];
  private listeners: Array<(entry: CostEntry) => void> = [];

  track(
    request: CompletionRequest,
    response: CompletionResponse,
    metadata?: Record<string, unknown>
  ): CostEntry {
    const entry: CostEntry = {
      timestamp: new Date(),
      provider: response.provider,
      model: response.model,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
      cost: response.cost || 0,
      metadata,
    };

    this.entries.push(entry);
    this.listeners.forEach(listener => listener(entry));

    return entry;
  }

  // Subscribe to cost events
  subscribe(listener: (entry: CostEntry) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // Analytics
  getTotalCost(filters?: {
    provider?: string;
    model?: string;
    userId?: string;
    since?: Date;
  }): number {
    return this.getEntries(filters).reduce((sum, entry) => sum + entry.cost, 0);
  }

  getTokenCount(filters?: {
    provider?: string;
    model?: string;
    userId?: string;
    since?: Date;
  }): { prompt: number; completion: number; total: number } {
    const entries = this.getEntries(filters);
    return {
      prompt: entries.reduce((sum, e) => sum + e.promptTokens, 0),
      completion: entries.reduce((sum, e) => sum + e.completionTokens, 0),
      total: entries.reduce((sum, e) => sum + e.totalTokens, 0),
    };
  }

  getStats(filters?: {
    provider?: string;
    model?: string;
    userId?: string;
    since?: Date;
  }) {
    const entries = this.getEntries(filters);
    const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);

    const byProvider = new Map<string, number>();
    const byModel = new Map<string, number>();

    entries.forEach(e => {
      byProvider.set(e.provider, (byProvider.get(e.provider) || 0) + e.cost);
      byModel.set(e.model, (byModel.get(e.model) || 0) + e.cost);
    });

    return {
      totalCost,
      requestCount: entries.length,
      ...this.getTokenCount(filters),
      byProvider: Object.fromEntries(byProvider),
      byModel: Object.fromEntries(byModel),
      averageCostPerRequest: totalCost / entries.length || 0,
    };
  }

  private getEntries(filters?: {
    provider?: string;
    model?: string;
    userId?: string;
    since?: Date;
  }): CostEntry[] {
    if (!filters) return this.entries;

    return this.entries.filter(entry => {
      if (filters.provider && entry.provider !== filters.provider) return false;
      if (filters.model && entry.model !== filters.model) return false;
      if (filters.userId && entry.metadata?.userId !== filters.userId) return false;
      if (filters.since && entry.timestamp < filters.since) return false;
      return true;
    });
  }

  // Export to CSV
  exportCSV(): string {
    const headers = ['timestamp', 'provider', 'model', 'promptTokens', 'completionTokens', 'totalTokens', 'cost'];
    const rows = this.entries.map(e => [
      e.timestamp.toISOString(),
      e.provider,
      e.model,
      e.promptTokens,
      e.completionTokens,
      e.totalTokens,
      e.cost.toFixed(6),
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  // Persist to storage
  async save(storage: { set: (key: string, value: string) => Promise<void> }): Promise<void> {
    await storage.set('cost-tracker-entries', JSON.stringify(this.entries));
  }

  async load(storage: { get: (key: string) => Promise<string | null> }): Promise<void> {
    const data = await storage.get('cost-tracker-entries');
    if (data) {
      this.entries = JSON.parse(data);
    }
  }
}

// Usage
const tracker = new CostTracker();

tracker.subscribe(entry => {
  console.log(`💰 ${entry.provider}/${entry.model}: $${entry.cost.toFixed(4)}`);
  
  // Alert on expensive requests
  if (entry.cost > 0.10) {
    console.warn(`⚠️ Expensive request: $${entry.cost.toFixed(4)}`);
  }
});
```

---

## Fallback Chains

### Resilient Provider Chain

```typescript
// fallback.ts
import type { LLMProvider, CompletionRequest, CompletionResponse } from './types';

export interface FallbackConfig {
  provider: LLMProvider;
  modelMap?: Record<string, string>; // Map requested model to provider's model
  maxRetries?: number;
  retryDelay?: number;
  enabled?: boolean;
}

export class FallbackChain {
  private configs: FallbackConfig[];
  private metrics = new Map<string, { success: number; failures: number }>();

  constructor(configs: FallbackConfig[]) {
    this.configs = configs.filter(c => c.enabled !== false);
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const errors: Array<{ provider: string; error: Error }> = [];

    for (const config of this.configs) {
      try {
        const mappedRequest = this.mapRequest(request, config);
        const response = await this.executeWithRetry(config.provider, mappedRequest, config);
        
        this.recordSuccess(config.provider.name);
        return response;
      } catch (error) {
        this.recordFailure(config.provider.name);
        errors.push({
          provider: config.provider.name,
          error: error as Error,
        });
        
        console.warn(`Provider ${config.provider.name} failed:`, error);
        // Continue to next provider
      }
    }

    // All providers failed
    throw new Error(
      `All providers failed:\n${errors.map(e => `  ${e.provider}: ${e.error.message}`).join('\n')}`
    );
  }

  async *stream(request: CompletionRequest): AsyncGenerator<any> {
    const errors: Array<{ provider: string; error: Error }> = [];

    for (const config of this.configs) {
      try {
        const mappedRequest = this.mapRequest(request, config);
        
        for await (const chunk of config.provider.stream(mappedRequest)) {
          yield chunk;
        }
        
        this.recordSuccess(config.provider.name);
        return; // Successfully streamed
      } catch (error) {
        this.recordFailure(config.provider.name);
        errors.push({
          provider: config.provider.name,
          error: error as Error,
        });
        
        console.warn(`Provider ${config.provider.name} failed:`, error);
        // Continue to next provider
      }
    }

    throw new Error(
      `All providers failed:\n${errors.map(e => `  ${e.provider}: ${e.error.message}`).join('\n')}`
    );
  }

  private async executeWithRetry(
    provider: LLMProvider,
    request: CompletionRequest,
    config: FallbackConfig
  ): Promise<CompletionResponse> {
    const maxRetries = config.maxRetries || 2;
    const retryDelay = config.retryDelay || 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await provider.complete(request);
      } catch (error) {
        if (attempt === maxRetries) throw error;
        
        // Exponential backoff
        const delay = retryDelay * Math.pow(2, attempt);
        console.log(`Retrying ${provider.name} in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error('Unreachable');
  }

  private mapRequest(request: CompletionRequest, config: FallbackConfig): CompletionRequest {
    const mappedModel = config.modelMap?.[request.model] || request.model;
    
    return {
      ...request,
      model: mappedModel,
    };
  }

  private recordSuccess(provider: string): void {
    const stats = this.metrics.get(provider) || { success: 0, failures: 0 };
    stats.success++;
    this.metrics.set(provider, stats);
  }

  private recordFailure(provider: string): void {
    const stats = this.metrics.get(provider) || { success: 0, failures: 0 };
    stats.failures++;
    this.metrics.set(provider, stats);
  }

  getMetrics() {
    const result: Record<string, any> = {};
    
    this.metrics.forEach((stats, provider) => {
      const total = stats.success + stats.failures;
      result[provider] = {
        ...stats,
        successRate: total > 0 ? stats.success / total : 0,
      };
    });

    return result;
  }
}

// Smart routing based on model capabilities
export class SmartRouter extends FallbackChain {
  private modelCapabilities = new Map<string, Set<string>>();

  constructor(configs: FallbackConfig[]) {
    super(configs);
    this.initializeCapabilities();
  }

  private initializeCapabilities(): void {
    // Define which providers support which models
    this.modelCapabilities.set('openai', new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']));
    this.modelCapabilities.set('anthropic', new Set(['claude-opus-4', 'claude-sonnet-4', 'claude-3-5-sonnet', 'claude-3-5-haiku']));
    this.modelCapabilities.set('gemini', new Set(['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']));
    this.modelCapabilities.set('ollama', new Set(['llama3.3', 'qwen2.5', 'mistral', 'phi']));
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    // Reorder providers based on model support
    const reorderedConfigs = this.reorderByCapability(request.model);
    
    if (reorderedConfigs.length === 0) {
      throw new Error(`No provider supports model: ${request.model}`);
    }

    const originalConfigs = this.configs;
    this.configs = reorderedConfigs;
    
    try {
      return await super.complete(request);
    } finally {
      this.configs = originalConfigs;
    }
  }

  private reorderByCapability(model: string): FallbackConfig[] {
    const supporting: FallbackConfig[] = [];
    const others: FallbackConfig[] = [];

    for (const config of this.configs) {
      const capabilities = this.modelCapabilities.get(config.provider.name);
      const supportsModel = capabilities?.has(model) || 
                            config.modelMap?.[model] !== undefined;

      if (supportsModel) {
        supporting.push(config);
      } else {
        others.push(config);
      }
    }

    return [...supporting, ...others];
  }
}
```

---

## Complete Example

### Putting It All Together

```typescript
// index.ts - Complete working example
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { OllamaProvider } from './providers/ollama';
import { FallbackChain, SmartRouter } from './fallback';
import { CostTracker } from './cost-tracking';
import { ToolRegistry, weatherTool, calculatorTool, executeToolLoop } from './tools';
import { StreamingHandler } from './streaming';

// Initialize providers
const openai = new OpenAIProvider(process.env.OPENAI_API_KEY!);
const anthropic = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!);
const gemini = new GeminiProvider(process.env.GEMINI_API_KEY!);
const ollama = new OllamaProvider();

// Setup fallback chain with smart routing
const router = new SmartRouter([
  {
    provider: openai,
    modelMap: {
      'gpt-4o': 'gpt-4o',
      'gpt-4o-mini': 'gpt-4o-mini',
    },
    maxRetries: 2,
  },
  {
    provider: anthropic,
    modelMap: {
      'gpt-4o': 'claude-sonnet-4-20250514', // Fallback mapping
      'gpt-4o-mini': 'claude-3-5-haiku-20241022',
    },
    maxRetries: 1,
  },
  {
    provider: gemini,
    modelMap: {
      'gpt-4o': 'gemini-1.5-pro',
      'gpt-4o-mini': 'gemini-2.0-flash-exp',
    },
  },
  {
    provider: ollama,
    modelMap: {
      'gpt-4o': 'llama3.3',
      'gpt-4o-mini': 'qwen2.5',
    },
    enabled: false, // Only use as last resort
  },
]);

// Setup cost tracking
const costTracker = new CostTracker();

costTracker.subscribe(entry => {
  console.log(
    `💰 ${entry.provider}/${entry.model}: ` +
    `${entry.totalTokens} tokens = $${entry.cost.toFixed(6)}`
  );
});

// Setup tools
const toolRegistry = new ToolRegistry();
toolRegistry.register(weatherTool);
toolRegistry.register(calculatorTool);

// Example 1: Simple completion with fallback
async function simpleCompletion() {
  console.log('\n=== Simple Completion ===\n');

  const request = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'user' as const, content: 'Explain TypeScript in one sentence.' },
    ],
    temperature: 0.7,
    maxTokens: 100,
  };

  const response = await router.complete(request);
  costTracker.track(request, response);

  console.log(`\n${response.provider}: ${response.content}\n`);
  console.log(`Tokens: ${response.usage.totalTokens}`);
}

// Example 2: Streaming response
async function streamingExample() {
  console.log('\n=== Streaming Example ===\n');

  const handler = new StreamingHandler(openai);

  await handler.streamWithCallback(
    {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user' as const, content: 'Write a short poem about coding.' },
      ],
    },
    (delta) => process.stdout.write(delta),
    () => console.log('\n')
  );
}

// Example 3: Tool calling
async function toolCallingExample() {
  console.log('\n=== Tool Calling Example ===\n');

  const request = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user' as const,
        content: 'What\'s the weather in San Francisco? Also calculate 42 * 137.',
      },
    ],
    tools: toolRegistry.getDefinitions(),
  };

  const response = await executeToolLoop(router, request, toolRegistry);
  costTracker.track(request, response);

  console.log(`\nFinal response: ${response.content}\n`);
}

// Example 4: Cost analytics
async function costAnalytics() {
  console.log('\n=== Cost Analytics ===\n');

  const stats = costTracker.getStats();
  console.log('Overall stats:', JSON.stringify(stats, null, 2));

  console.log('\nProvider metrics:', router.getMetrics());
}

// Run all examples
async function main() {
  try {
    await simpleCompletion();
    await streamingExample();
    await toolCallingExample();
    await costAnalytics();
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
```

---

## Best Practices

### 1. Error Handling

```typescript
class ProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

// Classify errors for smart retry logic
function isRetryable(error: any): boolean {
  // Network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') return true;
  
  // Rate limits
  if (error.statusCode === 429) return true;
  
  // Server errors
  if (error.statusCode >= 500) return true;
  
  return false;
}
```

### 2. Caching

```typescript
class CachedProvider implements LLMProvider {
  constructor(
    private provider: LLMProvider,
    private cache: Map<string, CompletionResponse> = new Map()
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const key = this.getCacheKey(request);
    
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const response = await this.provider.complete(request);
    this.cache.set(key, response);
    
    return response;
  }

  private getCacheKey(request: CompletionRequest): string {
    return JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
    });
  }

  async *stream(request: CompletionRequest) {
    yield* this.provider.stream(request);
  }

  listModels = () => this.provider.listModels();
  estimateCost = (req: any, res: any) => this.provider.estimateCost(req, res);
  name = this.provider.name;
}
```

### 3. Rate Limiting

```typescript
class RateLimitedProvider implements LLMProvider {
  private queue: Array<() => void> = [];
  private activeRequests = 0;

  constructor(
    private provider: LLMProvider,
    private maxConcurrent = 5,
    private requestsPerMinute = 60
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    await this.acquireSlot();
    
    try {
      return await this.provider.complete(request);
    } finally {
      this.releaseSlot();
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeRequests < this.maxConcurrent) {
      this.activeRequests++;
      return;
    }

    return new Promise(resolve => {
      this.queue.push(resolve);
    });
  }

  private releaseSlot(): void {
    this.activeRequests--;
    const next = this.queue.shift();
    if (next) {
      this.activeRequests++;
      next();
    }
  }

  async *stream(request: CompletionRequest) {
    yield* this.provider.stream(request);
  }

  listModels = () => this.provider.listModels();
  estimateCost = (req: any, res: any) => this.provider.estimateCost(req, res);
  name = this.provider.name;
}
```

### 4. Monitoring & Observability

```typescript
class ObservableProvider implements LLMProvider {
  constructor(
    private provider: LLMProvider,
    private onRequest?: (req: CompletionRequest) => void,
    private onResponse?: (req: CompletionRequest, res: CompletionResponse) => void,
    private onError?: (req: CompletionRequest, error: Error) => void
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now();
    this.onRequest?.(request);

    try {
      const response = await this.provider.complete(request);
      const duration = Date.now() - startTime;
      
      this.onResponse?.(request, { ...response, duration } as any);
      return response;
    } catch (error) {
      this.onError?.(request, error as Error);
      throw error;
    }
  }

  async *stream(request: CompletionRequest) {
    yield* this.provider.stream(request);
  }

  listModels = () => this.provider.listModels();
  estimateCost = (req: any, res: any) => this.provider.estimateCost(req, res);
  name = this.provider.name;
}
```

---

## Summary

This abstraction layer provides:

✅ **Unified interface** across 5+ LLM providers  
✅ **Automatic fallback** with smart routing  
✅ **Streaming support** with SSE format  
✅ **Tool calling normalization** with execution loop  
✅ **Cost tracking** with analytics  
✅ **Type safety** with TypeScript  
✅ **Production patterns** (caching, rate limiting, observability)

**Next steps:**
- Add authentication middleware
- Implement request/response logging
- Add metrics export (Prometheus, etc.)
- Build admin dashboard for cost monitoring
- Add support for embeddings & image generation
- Implement A/B testing framework

---

**License:** MIT  
**Author:** Phoenix Electric AI  
**Last Updated:** 2026-02-17
