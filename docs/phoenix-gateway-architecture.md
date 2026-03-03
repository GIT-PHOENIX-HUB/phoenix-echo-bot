# Phoenix Echo Gateway Architecture

**Version:** 1.0  
**Date:** 2026-02-17  
**Purpose:** Comprehensive architecture specification for building a custom, sovereign AI gateway

---

## Table of Contents

1. [Overview](#overview)
2. [Core Components](#core-components)
3. [WebSocket Server Architecture](#websocket-server-architecture)
4. [Channel Adapters](#channel-adapters)
5. [Agent Loop & Tool Execution](#agent-loop--tool-execution)
6. [LLM Provider Abstraction Layer](#llm-provider-abstraction-layer)
7. [Session & Memory Management](#session--memory-management)
8. [Webhook Handling](#webhook-handling)
9. [Security & Authentication](#security--authentication)
10. [Deployment Architecture](#deployment-architecture)
11. [Implementation Roadmap](#implementation-roadmap)

---

## Overview

Phoenix Echo Gateway is a multi-channel AI agent platform that provides:

- **Real-time bidirectional communication** via WebSocket
- **Multi-platform support** (Discord, Teams, WhatsApp, Telegram, WebChat, etc.)
- **LLM-agnostic architecture** supporting OpenAI, Anthropic, Azure OpenAI, and others
- **Persistent session and memory management** across conversations
- **Tool execution framework** with security sandboxing
- **Webhook ingestion** for asynchronous channel events

### Design Principles

1. **Modularity:** Each component is independently testable and replaceable
2. **Extensibility:** New channels, LLM providers, and tools can be added without core changes
3. **Resilience:** Graceful degradation, retry logic, and error boundaries
4. **Performance:** Sub-second message routing, efficient token usage
5. **Security:** Authentication, authorization, sandboxed tool execution

---

## Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Phoenix Echo Gateway                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  WebSocket   │    │   Webhook    │    │     HTTP     │  │
│  │   Server     │    │   Receiver   │    │     API      │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                    │          │
│         └───────────────────┴────────────────────┘          │
│                             │                                │
│                    ┌────────▼────────┐                       │
│                    │  Message Router │                       │
│                    └────────┬────────┘                       │
│                             │                                │
│         ┌───────────────────┼───────────────────┐            │
│         │                   │                   │            │
│  ┌──────▼──────┐   ┌────────▼────────┐   ┌─────▼──────┐    │
│  │  Channel    │   │  Session        │   │   Agent    │    │
│  │  Adapters   │   │  Manager        │   │   Loop     │    │
│  └──────┬──────┘   └────────┬────────┘   └─────┬──────┘    │
│         │                   │                   │            │
│  ┌──────▼──────────────────┬▼───────────────────▼──────┐    │
│  │     Discord  Teams  WA  │  Memory Store │  Tools    │    │
│  └─────────────────────────┴───────────────────────────┘    │
│                             │                                │
│                    ┌────────▼────────┐                       │
│                    │  LLM Abstraction│                       │
│                    │      Layer      │                       │
│                    └────────┬────────┘                       │
│                             │                                │
│         ┌───────────────────┼───────────────────┐            │
│         │                   │                   │            │
│  ┌──────▼──────┐   ┌────────▼────────┐   ┌─────▼──────┐    │
│  │   OpenAI    │   │   Anthropic     │   │   Azure    │    │
│  │     API     │   │      API        │   │  OpenAI    │    │
│  └─────────────┘   └─────────────────┘   └────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Component Stack

| Layer | Technology Options |
|-------|-------------------|
| **Runtime** | Node.js 20+ (recommended), Python 3.11+, Go 1.21+ |
| **WebSocket** | `ws` (Node), `Socket.IO`, `uWebSockets.js` |
| **Web Framework** | Express, Fastify, Hono |
| **Database** | PostgreSQL (primary), SQLite (development) |
| **Cache/Session Store** | Redis (recommended), Valkey, Memcached |
| **Message Queue** | Redis Pub/Sub, RabbitMQ, BullMQ |
| **Vector Store** | Redis (vector search), Pinecone, Qdrant |

---

## WebSocket Server Architecture

### Core Requirements

1. **Bidirectional Communication:** Client ↔ Server real-time messaging
2. **Connection Management:** Track active connections, handle reconnection
3. **Message Routing:** Dispatch to appropriate session/agent
4. **Heartbeat/Keepalive:** Detect stale connections
5. **Authentication:** Validate tokens before upgrading HTTP → WebSocket

### Implementation Pattern (Node.js)

```javascript
// ws-server.js
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { parse } from 'url';

class PhoenixWebSocketServer {
  constructor(options = {}) {
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ noServer: true });
    this.connections = new Map(); // connectionId → WebSocket
    this.sessions = new Map();    // sessionId → connectionId
    
    this.setupServer();
  }

  setupServer() {
    // HTTP upgrade handling
    this.httpServer.on('upgrade', async (request, socket, head) => {
      const { pathname, query } = parse(request.url, true);
      
      // Authenticate the upgrade request
      const token = query.token || this.extractToken(request);
      const auth = await this.authenticate(token);
      
      if (!auth.valid) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request, auth);
      });
    });

    // Connection handling
    this.wss.on('connection', (ws, request, auth) => {
      const connectionId = this.generateConnectionId();
      const sessionId = auth.sessionId || this.createSession(auth);
      
      this.connections.set(connectionId, ws);
      this.sessions.set(sessionId, connectionId);
      
      ws.connectionId = connectionId;
      ws.sessionId = sessionId;
      ws.userId = auth.userId;
      ws.isAlive = true;

      // Heartbeat
      ws.on('pong', () => { ws.isAlive = true; });

      // Message handling
      ws.on('message', async (data) => {
        await this.handleMessage(ws, data);
      });

      // Cleanup
      ws.on('close', () => {
        this.connections.delete(connectionId);
        this.sessions.delete(sessionId);
      });

      ws.on('error', (err) => {
        console.error(`WebSocket error [${connectionId}]:`, err);
      });

      // Send welcome message
      this.send(ws, { type: 'connected', sessionId, connectionId });
    });

    // Heartbeat interval (30s)
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  async handleMessage(ws, rawData) {
    try {
      const message = JSON.parse(rawData);
      
      // Route to agent loop
      const response = await this.messageRouter.route({
        sessionId: ws.sessionId,
        userId: ws.userId,
        channel: 'websocket',
        message: message.content,
        metadata: message.metadata || {}
      });

      // Stream response back
      if (response.stream) {
        for await (const chunk of response.stream) {
          this.send(ws, { type: 'chunk', content: chunk });
        }
        this.send(ws, { type: 'done' });
      } else {
        this.send(ws, { type: 'message', content: response.content });
      }
    } catch (err) {
      this.send(ws, { type: 'error', error: err.message });
    }
  }

  send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  async authenticate(token) {
    // Validate JWT/API key
    // Return { valid: true, userId, sessionId, permissions }
    return { valid: true, userId: 'user-123', permissions: [] };
  }

  generateConnectionId() {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  listen(port) {
    this.httpServer.listen(port, () => {
      console.log(`Phoenix Gateway listening on :${port}`);
    });
  }
}

export default PhoenixWebSocketServer;
```

### Scaling Considerations

**Single Server:**
- Handle ~10,000 concurrent connections per instance
- Use clustering (PM2, Node.js cluster module) for multi-core utilization

**Multi-Server (Distributed):**
- Use Redis Pub/Sub for cross-server messaging
- Store session → server mapping in Redis
- Use sticky sessions or connection routing

```javascript
// Redis-backed pub/sub for distributed WS
import Redis from 'ioredis';

class DistributedWSServer extends PhoenixWebSocketServer {
  constructor(options) {
    super(options);
    this.redis = new Redis(options.redisUrl);
    this.redisSub = new Redis(options.redisUrl);
    
    // Subscribe to messages for this server
    this.redisSub.subscribe('phoenix:broadcast');
    this.redisSub.on('message', (channel, message) => {
      const { sessionId, data } = JSON.parse(message);
      this.sendToSession(sessionId, data);
    });
  }

  async sendToSession(sessionId, data) {
    const connectionId = this.sessions.get(sessionId);
    if (connectionId) {
      const ws = this.connections.get(connectionId);
      this.send(ws, data);
    } else {
      // Session is on another server, publish to Redis
      await this.redis.publish('phoenix:broadcast', JSON.stringify({ sessionId, data }));
    }
  }
}
```

---

## Channel Adapters

Channel adapters translate platform-specific message formats into a unified internal format and vice versa.

### Adapter Interface

```typescript
interface ChannelAdapter {
  name: string; // 'discord', 'teams', 'whatsapp', etc.
  
  // Convert incoming platform message to internal format
  toInternal(platformMessage: any): InternalMessage;
  
  // Convert internal message to platform format
  toPlatform(internalMessage: InternalMessage): any;
  
  // Send message via platform API
  send(message: any, destination: string): Promise<void>;
  
  // Handle platform-specific events (reactions, edits, etc.)
  handleEvent(event: any): Promise<void>;
}

interface InternalMessage {
  id: string;
  sessionId: string;
  userId: string;
  channel: string; // 'discord', 'teams', etc.
  channelId: string; // platform-specific channel ID
  messageId: string; // platform-specific message ID
  content: string;
  attachments?: Attachment[];
  mentions?: Mention[];
  replyTo?: string;
  timestamp: Date;
  metadata: Record<string, any>;
}
```

### Discord Adapter Example

```javascript
// adapters/discord.js
import { Client, GatewayIntentBits, Events } from 'discord.js';

class DiscordAdapter {
  constructor(config, messageRouter) {
    this.name = 'discord';
    this.config = config;
    this.messageRouter = messageRouter;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
      ]
    });
    
    this.setupHandlers();
  }

  setupHandlers() {
    this.client.on(Events.ClientReady, () => {
      console.log(`Discord bot logged in as ${this.client.user.tag}`);
    });

    this.client.on(Events.MessageCreate, async (message) => {
      // Ignore bot messages
      if (message.author.bot) return;

      const internalMsg = this.toInternal(message);
      const response = await this.messageRouter.route(internalMsg);
      
      await this.send(response, message.channel.id);
    });

    this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
      await this.handleEvent({ type: 'reaction_add', reaction, user });
    });
  }

  toInternal(discordMessage) {
    return {
      id: `discord_${discordMessage.id}`,
      sessionId: `discord:${discordMessage.author.id}:${discordMessage.channel.id}`,
      userId: discordMessage.author.id,
      channel: 'discord',
      channelId: discordMessage.channel.id,
      messageId: discordMessage.id,
      content: discordMessage.content,
      attachments: discordMessage.attachments.map(a => ({
        url: a.url,
        filename: a.name,
        contentType: a.contentType
      })),
      mentions: discordMessage.mentions.users.map(u => ({
        id: u.id,
        username: u.username
      })),
      replyTo: discordMessage.reference?.messageId,
      timestamp: discordMessage.createdAt,
      metadata: {
        guildId: discordMessage.guild?.id,
        guildName: discordMessage.guild?.name
      }
    };
  }

  toPlatform(internalMessage) {
    return {
      content: internalMessage.content,
      embeds: internalMessage.embeds || [],
      components: internalMessage.components || [],
      files: internalMessage.attachments || []
    };
  }

  async send(internalMessage, channelId) {
    const channel = await this.client.channels.fetch(channelId);
    const platformMessage = this.toPlatform(internalMessage);
    await channel.send(platformMessage);
  }

  async handleEvent(event) {
    // Handle reactions, edits, deletes, etc.
    if (event.type === 'reaction_add') {
      // Process reaction logic
    }
  }

  async start() {
    await this.client.login(this.config.token);
  }
}

export default DiscordAdapter;
```

### Teams Adapter Example

```javascript
// adapters/teams.js
import { TeamsActivityHandler, CardFactory } from 'botbuilder';
import { BotFrameworkAdapter } from 'botbuilder';

class TeamsAdapter {
  constructor(config, messageRouter) {
    this.name = 'teams';
    this.config = config;
    this.messageRouter = messageRouter;
    
    this.adapter = new BotFrameworkAdapter({
      appId: config.appId,
      appPassword: config.appPassword
    });

    this.bot = new TeamsActivityHandler();
    this.setupHandlers();
  }

  setupHandlers() {
    this.bot.onMessage(async (context, next) => {
      const internalMsg = this.toInternal(context.activity);
      const response = await this.messageRouter.route(internalMsg);
      
      await context.sendActivity(this.toPlatform(response));
      await next();
    });
  }

  toInternal(activity) {
    return {
      id: `teams_${activity.id}`,
      sessionId: `teams:${activity.from.id}:${activity.conversation.id}`,
      userId: activity.from.id,
      channel: 'teams',
      channelId: activity.conversation.id,
      messageId: activity.id,
      content: activity.text,
      attachments: activity.attachments || [],
      timestamp: new Date(activity.timestamp),
      metadata: {
        tenantId: activity.channelData?.tenant?.id,
        teamId: activity.channelData?.team?.id
      }
    };
  }

  toPlatform(internalMessage) {
    return {
      type: 'message',
      text: internalMessage.content,
      attachments: internalMessage.cards || []
    };
  }

  // Webhook endpoint for Teams
  async handleWebhook(req, res) {
    await this.adapter.processActivity(req, res, async (context) => {
      await this.bot.run(context);
    });
  }
}

export default TeamsAdapter;
```

### WhatsApp Adapter (Meta Business API)

```javascript
// adapters/whatsapp.js
import axios from 'axios';

class WhatsAppAdapter {
  constructor(config, messageRouter) {
    this.name = 'whatsapp';
    this.config = config;
    this.messageRouter = messageRouter;
    this.apiUrl = `https://graph.facebook.com/v18.0/${config.phoneNumberId}`;
  }

  toInternal(webhookPayload) {
    const message = webhookPayload.entry[0].changes[0].value.messages[0];
    
    return {
      id: `whatsapp_${message.id}`,
      sessionId: `whatsapp:${message.from}`,
      userId: message.from,
      channel: 'whatsapp',
      channelId: message.from,
      messageId: message.id,
      content: message.text?.body || '',
      attachments: this.parseMediaAttachments(message),
      timestamp: new Date(parseInt(message.timestamp) * 1000),
      metadata: {
        type: message.type // text, image, audio, etc.
      }
    };
  }

  parseMediaAttachments(message) {
    if (message.type === 'image') {
      return [{ type: 'image', id: message.image.id }];
    }
    // Handle other media types
    return [];
  }

  async send(internalMessage, to) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'text',
      text: { body: internalMessage.content }
    };

    await axios.post(`${this.apiUrl}/messages`, payload, {
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async handleWebhook(payload) {
    if (payload.entry[0].changes[0].value.messages) {
      const internalMsg = this.toInternal(payload);
      const response = await this.messageRouter.route(internalMsg);
      await this.send(response, internalMsg.userId);
    }
  }

  verifyWebhook(mode, token, challenge) {
    if (mode === 'subscribe' && token === this.config.verifyToken) {
      return challenge;
    }
    throw new Error('Webhook verification failed');
  }
}

export default WhatsAppAdapter;
```

---

## Agent Loop & Tool Execution

The agent loop implements the **ReAct pattern** (Reasoning + Acting) with tool calling.

### Agent Loop Architecture

```
┌─────────────────────────────────────────────────┐
│              Agent Loop (ReAct)                  │
├─────────────────────────────────────────────────┤
│                                                  │
│  1. Receive user message                        │
│  2. Load session context & memory               │
│  3. Call LLM with tools available               │
│  4. ┌─────────────────────────────────┐         │
│     │ LLM Response:                   │         │
│     │  - Text only? → Return to user  │         │
│     │  - Tool calls? → Execute tools  │         │
│     └─────────────────────────────────┘         │
│  5. Execute tool(s) in parallel/sequence        │
│  6. Append tool results to conversation         │
│  7. Loop back to step 3 (max iterations: 25)    │
│  8. Return final response                       │
│  9. Update session memory                       │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Implementation

```javascript
// agent-loop.js
class AgentLoop {
  constructor({ llmProvider, toolRegistry, sessionManager, config = {} }) {
    this.llm = llmProvider;
    this.tools = toolRegistry;
    this.sessions = sessionManager;
    this.maxIterations = config.maxIterations || 25;
    this.thinkingBudget = config.thinkingBudget || 10000; // tokens
  }

  async run(message, sessionId) {
    const session = await this.sessions.get(sessionId);
    const conversationHistory = session.getHistory();
    
    // Add user message to history
    conversationHistory.push({
      role: 'user',
      content: message.content
    });

    let iterations = 0;
    let continueLoop = true;
    
    while (continueLoop && iterations < this.maxIterations) {
      iterations++;

      // Call LLM with tools
      const llmResponse = await this.llm.chat({
        model: session.model || 'claude-sonnet-4',
        messages: conversationHistory,
        tools: this.tools.getDefinitions(),
        temperature: 0.7
      });

      // Check if LLM wants to use tools
      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        // Execute tools
        const toolResults = await this.executeTools(llmResponse.toolCalls, session);
        
        // Add assistant message with tool calls
        conversationHistory.push({
          role: 'assistant',
          content: llmResponse.content || null,
          toolCalls: llmResponse.toolCalls
        });

        // Add tool results
        for (const result of toolResults) {
          conversationHistory.push({
            role: 'tool',
            toolCallId: result.toolCallId,
            content: JSON.stringify(result.output)
          });
        }

        // Continue loop to let LLM process tool results
      } else {
        // No tool calls, LLM provided final answer
        conversationHistory.push({
          role: 'assistant',
          content: llmResponse.content
        });
        continueLoop = false;
      }
    }

    // Update session
    await session.updateHistory(conversationHistory);
    await session.save();

    return {
      content: conversationHistory[conversationHistory.length - 1].content,
      iterations,
      session: session.toJSON()
    };
  }

  async executeTools(toolCalls, session) {
    const results = await Promise.all(
      toolCalls.map(async (call) => {
        try {
          const tool = this.tools.get(call.name);
          
          // Security check
          if (!this.isAllowed(tool, session)) {
            throw new Error(`Tool ${call.name} not permitted for this session`);
          }

          const output = await tool.execute(call.arguments, {
            sessionId: session.id,
            userId: session.userId,
            sandbox: true // Run in sandboxed environment
          });

          return {
            toolCallId: call.id,
            name: call.name,
            output: output,
            error: null
          };
        } catch (err) {
          return {
            toolCallId: call.id,
            name: call.name,
            output: null,
            error: err.message
          };
        }
      })
    );

    return results;
  }

  isAllowed(tool, session) {
    // Check permissions
    const permissions = session.permissions || [];
    return permissions.includes(tool.permission) || tool.permission === 'public';
  }
}

export default AgentLoop;
```

### Tool Registry

```javascript
// tools/registry.js
class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    this.tools.set(tool.name, tool);
  }

  get(name) {
    return this.tools.get(name);
  }

  getDefinitions() {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }
}

// Example tool
class WebSearchTool {
  constructor() {
    this.name = 'web_search';
    this.description = 'Search the web using Brave Search API';
    this.permission = 'tools.web_search';
    this.parameters = {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        },
        count: {
          type: 'number',
          description: 'Number of results (1-10)',
          default: 5
        }
      },
      required: ['query']
    };
  }

  async execute(args, context) {
    // Execute search
    const results = await braveSearchAPI(args.query, args.count);
    return {
      results: results.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.description
      }))
    };
  }
}

export { ToolRegistry, WebSearchTool };
```

### Tool Sandboxing

For security, tools should execute in isolated environments:

```javascript
// tools/sandbox.js
import { VM } from 'vm2'; // Sandboxed JS execution
import { spawn } from 'child_process';

class ToolSandbox {
  async executeCode(code, language, timeout = 30000) {
    switch (language) {
      case 'javascript':
        return this.executeJS(code, timeout);
      case 'python':
        return this.executePython(code, timeout);
      case 'shell':
        return this.executeShell(code, timeout);
      default:
        throw new Error(`Unsupported language: ${language}`);
    }
  }

  async executeJS(code, timeout) {
    const vm = new VM({
      timeout: timeout,
      sandbox: {
        console: {
          log: (...args) => { /* capture output */ }
        }
      }
    });
    
    return vm.run(code);
  }

  async executePython(code, timeout) {
    return new Promise((resolve, reject) => {
      const proc = spawn('python3', ['-c', code], {
        timeout: timeout,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr));
        }
      });

      proc.on('error', reject);
    });
  }

  async executeShell(command, timeout) {
    // Highly restricted - whitelist commands only
    const allowed = ['ls', 'cat', 'echo', 'pwd'];
    const cmd = command.split(' ')[0];
    
    if (!allowed.includes(cmd)) {
      throw new Error(`Command not allowed: ${cmd}`);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn('sh', ['-c', command], { timeout });
      let output = '';
      proc.stdout.on('data', (data) => { output += data; });
      proc.on('close', () => resolve(output));
      proc.on('error', reject);
    });
  }
}

export default ToolSandbox;
```

---

## LLM Provider Abstraction Layer

A unified interface for multiple LLM providers (OpenAI, Anthropic, Azure OpenAI, etc.).

### Provider Interface

```typescript
interface LLMProvider {
  name: string;
  
  // Chat completion (supports streaming)
  chat(request: ChatRequest): Promise<ChatResponse> | AsyncIterator<ChatChunk>;
  
  // Embeddings generation
  embed(text: string | string[]): Promise<EmbeddingResponse>;
  
  // Token counting
  countTokens(messages: Message[]): number;
  
  // Model capabilities
  getCapabilities(model: string): ModelCapabilities;
}

interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: Tool[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  topP?: number;
  stopSequences?: string[];
}

interface ChatResponse {
  id: string;
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
  model: string;
}
```

### Abstraction Implementation

```javascript
// llm/provider-factory.js
class LLMProviderFactory {
  static create(providerName, config) {
    switch (providerName.toLowerCase()) {
      case 'anthropic':
        return new AnthropicProvider(config);
      case 'openai':
        return new OpenAIProvider(config);
      case 'azure':
        return new AzureOpenAIProvider(config);
      case 'gemini':
        return new GeminiProvider(config);
      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
  }
}

// llm/anthropic-provider.js
import Anthropic from '@anthropic-ai/sdk';

class AnthropicProvider {
  constructor(config) {
    this.name = 'anthropic';
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL // Optional for custom endpoints
    });
  }

  async chat(request) {
    // Transform to Anthropic format
    const { system, messages } = this.transformMessages(request.messages);
    
    const response = await this.client.messages.create({
      model: request.model || 'claude-sonnet-4',
      system: system,
      messages: messages,
      tools: request.tools || [],
      temperature: request.temperature,
      max_tokens: request.maxTokens || 4096,
      stream: request.stream || false
    });

    if (request.stream) {
      return this.streamResponse(response);
    }

    return this.parseResponse(response);
  }

  transformMessages(messages) {
    // Separate system messages from conversation
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');
    
    return {
      system: systemMessages.map(m => m.content).join('\n\n'),
      messages: conversationMessages
    };
  }

  parseResponse(response) {
    return {
      id: response.id,
      content: response.content[0].type === 'text' ? response.content[0].text : null,
      toolCalls: response.content.filter(c => c.type === 'tool_use').map(c => ({
        id: c.id,
        name: c.name,
        arguments: c.input
      })),
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens
      },
      finishReason: response.stop_reason,
      model: response.model
    };
  }

  async *streamResponse(stream) {
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield {
          type: 'chunk',
          content: event.delta.text
        };
      } else if (event.type === 'message_stop') {
        yield { type: 'done' };
      }
    }
  }

  async embed(text) {
    // Anthropic doesn't provide embeddings, use Voyage AI or similar
    throw new Error('Anthropic does not support embeddings');
  }

  countTokens(messages) {
    // Approximate token count (use tiktoken for accuracy)
    return messages.reduce((sum, msg) => {
      return sum + Math.ceil(msg.content.length / 4);
    }, 0);
  }

  getCapabilities(model) {
    return {
      maxTokens: 200000,
      supportsTools: true,
      supportsVision: model.includes('opus') || model.includes('sonnet'),
      supportsStreaming: true,
      contextWindow: 200000
    };
  }
}

// llm/openai-provider.js
import OpenAI from 'openai';

class OpenAIProvider {
  constructor(config) {
    this.name = 'openai';
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL
    });
  }

  async chat(request) {
    const response = await this.client.chat.completions.create({
      model: request.model || 'gpt-4-turbo',
      messages: request.messages,
      tools: request.tools,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: request.stream || false
    });

    if (request.stream) {
      return this.streamResponse(response);
    }

    return this.parseResponse(response);
  }

  parseResponse(response) {
    const message = response.choices[0].message;
    
    return {
      id: response.id,
      content: message.content,
      toolCalls: message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments)
      })),
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      },
      finishReason: response.choices[0].finish_reason,
      model: response.model
    };
  }

  async *streamResponse(stream) {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield { type: 'chunk', content: delta.content };
      }
      if (chunk.choices[0]?.finish_reason) {
        yield { type: 'done' };
      }
    }
  }

  async embed(texts) {
    const input = Array.isArray(texts) ? texts : [texts];
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: input
    });

    return {
      embeddings: response.data.map(d => d.embedding),
      model: response.model,
      usage: response.usage
    };
  }

  getCapabilities(model) {
    const capabilities = {
      'gpt-4-turbo': { maxTokens: 128000, contextWindow: 128000 },
      'gpt-4': { maxTokens: 8192, contextWindow: 8192 },
      'gpt-3.5-turbo': { maxTokens: 16385, contextWindow: 16385 }
    };

    return {
      ...capabilities[model] || { maxTokens: 4096, contextWindow: 4096 },
      supportsTools: true,
      supportsVision: model.includes('vision') || model.includes('turbo'),
      supportsStreaming: true
    };
  }
}

export { LLMProviderFactory, AnthropicProvider, OpenAIProvider };
```

### Multi-Provider Routing (LiteLLM Pattern)

```javascript
// llm/router.js
class LLMRouter {
  constructor(config) {
    this.providers = new Map();
    this.fallbacks = config.fallbacks || {};
    this.loadBalancing = config.loadBalancing || 'round-robin';
    this.currentIndex = 0;
  }

  registerProvider(name, provider) {
    this.providers.set(name, provider);
  }

  async chat(request) {
    const providerName = request.provider || this.selectProvider(request.model);
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`Provider not found: ${providerName}`);
    }

    try {
      return await provider.chat(request);
    } catch (err) {
      // Fallback logic
      if (this.fallbacks[providerName]) {
        const fallbackProvider = this.providers.get(this.fallbacks[providerName]);
        return await fallbackProvider.chat({
          ...request,
          model: this.mapModelToProvider(request.model, this.fallbacks[providerName])
        });
      }
      throw err;
    }
  }

  selectProvider(model) {
    // Model-based routing
    if (model.startsWith('claude')) return 'anthropic';
    if (model.startsWith('gpt')) return 'openai';
    if (model.startsWith('gemini')) return 'gemini';
    
    // Default load balancing
    const providers = Array.from(this.providers.keys());
    this.currentIndex = (this.currentIndex + 1) % providers.length;
    return providers[this.currentIndex];
  }

  mapModelToProvider(model, provider) {
    // Map models across providers (e.g., gpt-4 → claude-opus)
    const mappings = {
      'gpt-4': { anthropic: 'claude-opus-4', gemini: 'gemini-1.5-pro' },
      'claude-opus-4': { openai: 'gpt-4-turbo', gemini: 'gemini-1.5-pro' }
    };
    
    return mappings[model]?.[provider] || model;
  }
}

export default LLMRouter;
```

---

## Session & Memory Management

### Session Structure

```typescript
interface Session {
  id: string;
  userId: string;
  channel: string; // 'discord', 'teams', 'websocket', etc.
  channelId: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  
  // Conversation state
  conversationHistory: Message[];
  model: string;
  temperature: number;
  
  // Memory
  shortTermMemory: Record<string, any>; // Current session context
  longTermMemory: string[]; // Persistent facts (stored in vector DB)
  
  // Permissions & config
  permissions: string[];
  maxTokens: number;
  tools: string[];
  
  // Metadata
  metadata: Record<string, any>;
}
```

### Session Manager

```javascript
// session/manager.js
import Redis from 'ioredis';

class SessionManager {
  constructor(config) {
    this.redis = new Redis(config.redisUrl);
    this.db = config.database; // PostgreSQL or similar
    this.ttl = config.sessionTTL || 3600 * 24; // 24 hours
    this.vectorStore = config.vectorStore; // For long-term memory
  }

  async get(sessionId) {
    // Try cache first
    const cached = await this.redis.get(`session:${sessionId}`);
    if (cached) {
      return new Session(JSON.parse(cached), this);
    }

    // Load from database
    const row = await this.db.query(
      'SELECT * FROM sessions WHERE id = $1',
      [sessionId]
    );

    if (row.rows.length === 0) {
      return null;
    }

    const session = new Session(row.rows[0], this);
    await this.cache(session);
    return session;
  }

  async create(data) {
    const session = new Session({
      id: this.generateId(),
      userId: data.userId,
      channel: data.channel,
      channelId: data.channelId,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + this.ttl * 1000),
      conversationHistory: [],
      model: data.model || 'claude-sonnet-4',
      temperature: data.temperature || 0.7,
      shortTermMemory: {},
      longTermMemory: [],
      permissions: data.permissions || [],
      maxTokens: 4096,
      tools: data.tools || [],
      metadata: data.metadata || {}
    }, this);

    await this.save(session);
    return session;
  }

  async save(session) {
    // Save to database
    await this.db.query(`
      INSERT INTO sessions (id, user_id, channel, channel_id, created_at, updated_at, expires_at, data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        updated_at = $6,
        expires_at = $7,
        data = $8
    `, [
      session.id,
      session.userId,
      session.channel,
      session.channelId,
      session.createdAt,
      session.updatedAt,
      session.expiresAt,
      JSON.stringify(session.toJSON())
    ]);

    // Cache in Redis
    await this.cache(session);
  }

  async cache(session) {
    await this.redis.setex(
      `session:${session.id}`,
      this.ttl,
      JSON.stringify(session.toJSON())
    );
  }

  async delete(sessionId) {
    await this.db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    await this.redis.del(`session:${sessionId}`);
  }

  generateId() {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

class Session {
  constructor(data, manager) {
    Object.assign(this, data);
    this.manager = manager;
  }

  getHistory() {
    return this.conversationHistory || [];
  }

  async updateHistory(messages) {
    this.conversationHistory = messages;
    this.updatedAt = new Date();
    
    // Trim history if too long (keep last N messages)
    const maxMessages = 50;
    if (this.conversationHistory.length > maxMessages) {
      // Archive old messages to long-term memory
      const toArchive = this.conversationHistory.slice(0, -maxMessages);
      await this.archiveToLongTerm(toArchive);
      this.conversationHistory = this.conversationHistory.slice(-maxMessages);
    }
  }

  async archiveToLongTerm(messages) {
    // Summarize and store in vector database
    const summary = await this.summarize(messages);
    const embedding = await this.manager.vectorStore.embed(summary);
    
    await this.manager.vectorStore.store({
      sessionId: this.id,
      content: summary,
      embedding: embedding,
      timestamp: new Date()
    });
  }

  async summarize(messages) {
    // Use LLM to summarize conversation chunk
    return messages.map(m => `${m.role}: ${m.content}`).join('\n');
  }

  async recall(query) {
    // Semantic search in long-term memory
    const results = await this.manager.vectorStore.search(query, {
      filter: { sessionId: this.id },
      limit: 5
    });
    
    return results.map(r => r.content);
  }

  async save() {
    await this.manager.save(this);
  }

  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      channel: this.channel,
      channelId: this.channelId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      expiresAt: this.expiresAt,
      conversationHistory: this.conversationHistory,
      model: this.model,
      temperature: this.temperature,
      shortTermMemory: this.shortTermMemory,
      longTermMemory: this.longTermMemory,
      permissions: this.permissions,
      maxTokens: this.maxTokens,
      tools: this.tools,
      metadata: this.metadata
    };
  }
}

export { SessionManager, Session };
```

### Vector Store for Long-Term Memory (Redis)

```javascript
// memory/vector-store.js
import Redis from 'ioredis';

class RedisVectorStore {
  constructor(config) {
    this.redis = new Redis(config.redisUrl);
    this.indexName = 'phoenix:memory';
    this.embeddingDim = 1536; // OpenAI text-embedding-3-small
    this.llm = config.llmProvider;
  }

  async initialize() {
    // Create vector search index
    try {
      await this.redis.call('FT.CREATE', this.indexName,
        'ON', 'HASH',
        'PREFIX', '1', 'memory:',
        'SCHEMA',
        'sessionId', 'TAG',
        'userId', 'TAG',
        'content', 'TEXT',
        'timestamp', 'NUMERIC', 'SORTABLE',
        'embedding', 'VECTOR', 'FLAT', '6',
          'TYPE', 'FLOAT32',
          'DIM', this.embeddingDim,
          'DISTANCE_METRIC', 'COSINE'
      );
    } catch (err) {
      if (!err.message.includes('Index already exists')) {
        throw err;
      }
    }
  }

  async store({ sessionId, userId, content, embedding, timestamp }) {
    const id = `memory:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    
    // If embedding not provided, generate it
    if (!embedding) {
      const embeddingResponse = await this.llm.embed(content);
      embedding = embeddingResponse.embeddings[0];
    }

    // Convert embedding to Buffer
    const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);

    await this.redis.hset(id, {
      sessionId: sessionId || '',
      userId: userId || '',
      content: content,
      timestamp: timestamp ? timestamp.getTime() : Date.now(),
      embedding: embeddingBuffer
    });

    return id;
  }

  async search(query, options = {}) {
    // Generate query embedding
    const queryEmbedding = await this.llm.embed(query);
    const queryBuffer = Buffer.from(new Float32Array(queryEmbedding.embeddings[0]).buffer);

    // Build filter
    let filter = '*';
    if (options.filter) {
      const filters = [];
      if (options.filter.sessionId) {
        filters.push(`@sessionId:{${options.filter.sessionId}}`);
      }
      if (options.filter.userId) {
        filters.push(`@userId:{${options.filter.userId}}`);
      }
      if (filters.length > 0) {
        filter = filters.join(' ');
      }
    }

    // Vector search
    const results = await this.redis.call('FT.SEARCH', this.indexName,
      filter,
      'RETURN', '3', 'sessionId', 'content', 'timestamp',
      'SORTBY', '__embedding_score',
      'LIMIT', '0', options.limit || 10,
      'PARAMS', '2', 'embedding', queryBuffer,
      'DIALECT', '2'
    );

    // Parse results
    const memories = [];
    for (let i = 1; i < results.length; i += 2) {
      const fields = results[i + 1];
      memories.push({
        id: results[i],
        sessionId: fields[1],
        content: fields[3],
        timestamp: new Date(parseInt(fields[5]))
      });
    }

    return memories;
  }

  async delete(id) {
    await this.redis.del(id);
  }
}

export default RedisVectorStore;
```

---

## Webhook Handling

### Webhook Server

```javascript
// webhook/server.js
import express from 'express';
import crypto from 'crypto';

class WebhookServer {
  constructor(config, adapters) {
    this.app = express();
    this.adapters = adapters;
    this.config = config;
    
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    this.setupRoutes();
  }

  setupRoutes() {
    // Discord webhook
    this.app.post('/webhooks/discord', async (req, res) => {
      // Discord uses interactions endpoint, not webhooks for bots
      // This would be for Discord webhook URLs (non-bot)
      const adapter = this.adapters.get('discord');
      await adapter.handleWebhook(req.body);
      res.status(200).send('OK');
    });

    // Teams webhook
    this.app.post('/webhooks/teams', async (req, res) => {
      const adapter = this.adapters.get('teams');
      await adapter.handleWebhook(req, res);
    });

    // WhatsApp webhook (Meta Business API)
    this.app.get('/webhooks/whatsapp', (req, res) => {
      const adapter = this.adapters.get('whatsapp');
      try {
        const challenge = adapter.verifyWebhook(
          req.query['hub.mode'],
          req.query['hub.verify_token'],
          req.query['hub.challenge']
        );
        res.status(200).send(challenge);
      } catch (err) {
        res.status(403).send('Forbidden');
      }
    });

    this.app.post('/webhooks/whatsapp', async (req, res) => {
      // Verify signature
      const signature = req.headers['x-hub-signature-256'];
      if (!this.verifyWhatsAppSignature(req.body, signature)) {
        return res.status(403).send('Invalid signature');
      }

      const adapter = this.adapters.get('whatsapp');
      await adapter.handleWebhook(req.body);
      res.status(200).send('OK');
    });

    // Telegram webhook
    this.app.post('/webhooks/telegram/:botToken', async (req, res) => {
      const adapter = this.adapters.get('telegram');
      await adapter.handleWebhook(req.body);
      res.status(200).send('OK');
    });

    // Generic webhook endpoint
    this.app.post('/webhooks/:channel', async (req, res) => {
      const adapter = this.adapters.get(req.params.channel);
      if (!adapter) {
        return res.status(404).send('Channel not found');
      }
      
      await adapter.handleWebhook(req.body);
      res.status(200).send('OK');
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok', timestamp: new Date() });
    });
  }

  verifyWhatsAppSignature(payload, signature) {
    const appSecret = this.config.whatsapp.appSecret;
    const expectedSignature = crypto
      .createHmac('sha256', appSecret)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    return signature === `sha256=${expectedSignature}`;
  }

  listen(port) {
    this.app.listen(port, () => {
      console.log(`Webhook server listening on :${port}`);
    });
  }
}

export default WebhookServer;
```

### Webhook Queue Processing (for async handling)

```javascript
// webhook/queue.js
import Bull from 'bull';

class WebhookQueue {
  constructor(redisUrl) {
    this.queue = new Bull('webhooks', redisUrl);
    this.setupProcessors();
  }

  setupProcessors() {
    this.queue.process('discord', async (job) => {
      // Process Discord webhook
      return await this.processDiscord(job.data);
    });

    this.queue.process('teams', async (job) => {
      return await this.processTeams(job.data);
    });

    this.queue.process('whatsapp', async (job) => {
      return await this.processWhatsApp(job.data);
    });
  }

  async enqueue(channel, data, options = {}) {
    return await this.queue.add(channel, data, {
      attempts: options.retries || 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: true,
      removeOnFail: false
    });
  }

  async processDiscord(data) {
    // Handle Discord webhook
  }

  async processTeams(data) {
    // Handle Teams webhook
  }

  async processWhatsApp(data) {
    // Handle WhatsApp webhook
  }
}

export default WebhookQueue;
```

---

## Security & Authentication

### API Key Authentication

```javascript
// auth/api-key.js
class APIKeyAuth {
  constructor(db) {
    this.db = db;
  }

  async validate(apiKey) {
    const hash = this.hashKey(apiKey);
    const result = await this.db.query(
      'SELECT * FROM api_keys WHERE key_hash = $1 AND (expires_at IS NULL OR expires_at > NOW())',
      [hash]
    );

    if (result.rows.length === 0) {
      return { valid: false };
    }

    const key = result.rows[0];
    
    // Update last used
    await this.db.query(
      'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
      [key.id]
    );

    return {
      valid: true,
      userId: key.user_id,
      permissions: key.permissions,
      rateLimit: key.rate_limit
    };
  }

  hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  async create(userId, permissions = [], expiresAt = null) {
    const apiKey = `pk_${this.generateRandomString(32)}`;
    const hash = this.hashKey(apiKey);

    await this.db.query(
      'INSERT INTO api_keys (key_hash, user_id, permissions, expires_at) VALUES ($1, $2, $3, $4)',
      [hash, userId, permissions, expiresAt]
    );

    return apiKey; // Return only once, never stored in plaintext
  }

  generateRandomString(length) {
    return crypto.randomBytes(length).toString('base64url').substring(0, length);
  }
}

export default APIKeyAuth;
```

### JWT Authentication

```javascript
// auth/jwt.js
import jwt from 'jsonwebtoken';

class JWTAuth {
  constructor(config) {
    this.secret = config.jwtSecret;
    this.issuer = config.issuer || 'phoenix-gateway';
    this.expiresIn = config.expiresIn || '24h';
  }

  sign(payload) {
    return jwt.sign(payload, this.secret, {
      issuer: this.issuer,
      expiresIn: this.expiresIn
    });
  }

  verify(token) {
    try {
      return jwt.verify(token, this.secret, {
        issuer: this.issuer
      });
    } catch (err) {
      return null;
    }
  }

  middleware() {
    return (req, res, next) => {
      const token = this.extractToken(req);
      
      if (!token) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const decoded = this.verify(token);
      
      if (!decoded) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      req.user = decoded;
      next();
    };
  }

  extractToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return req.query.token || req.cookies?.token;
  }
}

export default JWTAuth;
```

### Rate Limiting

```javascript
// middleware/rate-limit.js
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';

class RateLimiter {
  constructor(redisUrl) {
    this.redis = new Redis(redisUrl);
  }

  create(options = {}) {
    return rateLimit({
      store: new RedisStore({
        client: this.redis,
        prefix: 'rl:'
      }),
      windowMs: options.windowMs || 60 * 1000, // 1 minute
      max: options.max || 60, // 60 requests per minute
      message: options.message || 'Too many requests',
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        // Use API key or IP
        return req.user?.userId || req.ip;
      }
    });
  }

  createTiered(tiers) {
    // Different limits for different user tiers
    return async (req, res, next) => {
      const userTier = req.user?.tier || 'free';
      const limits = tiers[userTier] || tiers.free;
      
      const limiter = this.create(limits);
      limiter(req, res, next);
    };
  }
}

export default RateLimiter;
```

---

## Deployment Architecture

### Production Stack

```
┌─────────────────────────────────────────────────────────┐
│                      Load Balancer                       │
│                     (Nginx / Caddy)                      │
└────────────────────┬────────────────────────────────────┘
                     │
         ┌───────────┼───────────┐
         │           │           │
┌────────▼───┐  ┌────▼────┐  ┌──▼──────┐
│  Gateway   │  │ Gateway │  │ Gateway │
│  Instance  │  │Instance │  │Instance │
│     1      │  │    2    │  │    3    │
└────────┬───┘  └────┬────┘  └──┬──────┘
         │           │           │
         └───────────┼───────────┘
                     │
         ┌───────────┼───────────┐
         │           │           │
┌────────▼───┐  ┌────▼────┐  ┌──▼──────┐
│   Redis    │  │Postgres │  │ Vector  │
│  Cluster   │  │ Primary │  │  Store  │
│ (Sessions) │  │+Replicas│  │ (Redis) │
└────────────┘  └─────────┘  └─────────┘
```

### Docker Compose Example

```yaml
# docker-compose.yml
version: '3.8'

services:
  gateway:
    build: .
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/phoenix
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    ports:
      - "3000:3000"
    depends_on:
      - redis
      - postgres
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '2'
          memory: 2G

  redis:
    image: redis/redis-stack:latest
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=phoenix
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./certs:/etc/nginx/certs
    depends_on:
      - gateway

volumes:
  redis-data:
  postgres-data:
```

### Environment Variables

```bash
# .env.example

# Server
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/phoenix
REDIS_URL=redis://localhost:6379

# LLM Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
AZURE_OPENAI_ENDPOINT=https://...
AZURE_OPENAI_API_KEY=...

# Channel Tokens
DISCORD_BOT_TOKEN=...
TEAMS_APP_ID=...
TEAMS_APP_PASSWORD=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...
TELEGRAM_BOT_TOKEN=...

# Security
JWT_SECRET=...
API_KEY_SALT=...

# Gateway Config
GATEWAY_URL=https://claw.phoenixelectric.life
WEBHOOK_BASE_URL=https://claw.phoenixelectric.life/webhooks

# Limits
MAX_TOKENS=4096
MAX_ITERATIONS=25
SESSION_TTL=86400
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=60
```

---

## Implementation Roadmap

### Phase 1: Core Foundation (Week 1-2)

- [ ] WebSocket server with basic connection management
- [ ] Session manager with Redis caching
- [ ] LLM provider abstraction (Anthropic, OpenAI)
- [ ] Basic agent loop (ReAct pattern)
- [ ] PostgreSQL schema for sessions, users, API keys

### Phase 2: Channel Adapters (Week 3-4)

- [ ] Discord adapter (bot + interactions)
- [ ] Teams adapter (Bot Framework)
- [ ] WhatsApp adapter (Meta Business API)
- [ ] WebChat adapter (direct WebSocket)
- [ ] Telegram adapter (optional)

### Phase 3: Tool Execution (Week 5-6)

- [ ] Tool registry and definition system
- [ ] Sandboxed execution environment
- [ ] Core tools: web_search, file operations, code execution
- [ ] Tool permission system
- [ ] MCP (Model Context Protocol) server integration

### Phase 4: Memory & Advanced Features (Week 7-8)

- [ ] Vector store integration (Redis vector search)
- [ ] Long-term memory archival
- [ ] Semantic search in conversation history
- [ ] Multi-session context sharing
- [ ] Memory summarization

### Phase 5: Webhooks & Scaling (Week 9-10)

- [ ] Webhook server with signature verification
- [ ] Queue-based webhook processing
- [ ] Multi-instance deployment with Redis pub/sub
- [ ] Load balancing and sticky sessions
- [ ] Health checks and monitoring

### Phase 6: Security & Production (Week 11-12)

- [ ] API key authentication
- [ ] JWT token system
- [ ] Rate limiting (tiered)
- [ ] Audit logging
- [ ] HTTPS/TLS configuration
- [ ] Production deployment (Docker + Kubernetes/VPS)

### Phase 7: Testing & Documentation (Week 13-14)

- [ ] Unit tests (Jest/Mocha)
- [ ] Integration tests
- [ ] Load testing
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Deployment guide
- [ ] User documentation

---

## Database Schema

```sql
-- PostgreSQL schema

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE,
  username VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(64) UNIQUE NOT NULL,
  permissions TEXT[] DEFAULT '{}',
  rate_limit INTEGER DEFAULT 60,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP
);

CREATE TABLE sessions (
  id VARCHAR(100) PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(50) NOT NULL,
  channel_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  data JSONB NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_channel ON sessions(channel, channel_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE conversation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(100) REFERENCES sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL, -- 'user', 'assistant', 'system', 'tool'
  content TEXT,
  tool_calls JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conversation_session_id ON conversation_history(session_id, timestamp DESC);

CREATE TABLE tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(100) REFERENCES sessions(id),
  tool_name VARCHAR(100) NOT NULL,
  arguments JSONB,
  result JSONB,
  error TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id VARCHAR(255),
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user_id ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log(action);
```

---

## Additional Resources

### Recommended Libraries (Node.js)

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.20.0",
    "openai": "^4.28.0",
    "discord.js": "^14.14.1",
    "botbuilder": "^4.21.0",
    "express": "^4.18.2",
    "ws": "^8.16.0",
    "ioredis": "^5.3.2",
    "pg": "^8.11.3",
    "bull": "^4.12.0",
    "jsonwebtoken": "^9.0.2",
    "express-rate-limit": "^7.1.5",
    "rate-limit-redis": "^4.2.0",
    "axios": "^1.6.7",
    "dotenv": "^16.4.5",
    "zod": "^3.22.4",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^6.3.4",
    "nodemon": "^3.0.3",
    "eslint": "^8.56.0"
  }
}
```

### Performance Optimizations

1. **Connection Pooling:** Use `pg-pool` for PostgreSQL, connection pooling for Redis
2. **Caching Strategy:** Cache session data in Redis, invalidate on updates
3. **Message Batching:** Batch tool executions when possible
4. **Streaming:** Stream LLM responses to reduce latency
5. **CDN:** Serve static assets (web client) via CDN
6. **Database Indexes:** Index frequently queried fields
7. **Rate Limiting:** Implement tiered rate limits per user

### Monitoring & Observability

```javascript
// monitoring/metrics.js
import prometheus from 'prom-client';

class Metrics {
  constructor() {
    this.register = new prometheus.Registry();
    
    // Default metrics
    prometheus.collectDefaultMetrics({ register: this.register });
    
    // Custom metrics
    this.messageCounter = new prometheus.Counter({
      name: 'phoenix_messages_total',
      help: 'Total number of messages processed',
      labelNames: ['channel', 'status'],
      registers: [this.register]
    });

    this.llmDuration = new prometheus.Histogram({
      name: 'phoenix_llm_duration_seconds',
      help: 'LLM request duration',
      labelNames: ['provider', 'model'],
      registers: [this.register]
    });

    this.activeConnections = new prometheus.Gauge({
      name: 'phoenix_active_connections',
      help: 'Number of active WebSocket connections',
      registers: [this.register]
    });
  }

  recordMessage(channel, status) {
    this.messageCounter.inc({ channel, status });
  }

  recordLLMDuration(provider, model, duration) {
    this.llmDuration.observe({ provider, model }, duration);
  }

  setActiveConnections(count) {
    this.activeConnections.set(count);
  }

  async getMetrics() {
    return await this.register.metrics();
  }
}

export default Metrics;
```

---

## Summary

This architecture provides a **production-ready foundation** for Phoenix Echo Gateway with:

✅ **Multi-channel support** via pluggable adapters  
✅ **LLM-agnostic design** with provider abstraction  
✅ **Scalable WebSocket server** with Redis pub/sub  
✅ **ReAct agent loop** with tool execution sandboxing  
✅ **Persistent session & memory** management  
✅ **Webhook handling** for async channel events  
✅ **Security** with API keys, JWT, rate limiting  
✅ **Production deployment** with Docker/Kubernetes  

**Next Steps:**
1. Set up development environment
2. Implement Phase 1 (core foundation)
3. Test with a single channel (WebChat or Discord)
4. Iterate and expand to additional channels
5. Deploy to production VPS/cloud

---

**Document Version:** 1.0  
**Last Updated:** 2026-02-17  
**Maintainer:** Phoenix Echo  
**License:** Internal Use Only
