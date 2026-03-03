# Phoenix Echo Gateway - Implementation Roadmap

**Document Version:** 1.0  
**Last Updated:** 2026-02-17  
**Status:** Planning

## Overview

This roadmap outlines the phased development of Phoenix Echo Gateway, a unified communication and AI orchestration platform that bridges multiple channels (webchat, Teams, Discord, etc.) with LLM providers and tool execution capabilities.

### Architecture Goals

- **Multi-channel support:** Single gateway handles webchat, Teams, Discord, Slack, etc.
- **LLM abstraction:** Provider-agnostic interface (OpenAI, Anthropic, Azure OpenAI, etc.)
- **Tool execution:** MCP integration, Azure Functions, custom tools
- **Session management:** Persistent context across conversations
- **Production-ready:** Scalable, monitored, secure

---

## Phase 0: Foundation (WebSocket Server & Basic Routing)

**Objective:** Establish core infrastructure for real-time bidirectional communication

### Tasks

1. **WebSocket Server Setup**
   - Initialize Node.js/TypeScript project structure
   - Install dependencies: `ws`, `express`, `dotenv`, `winston`
   - Create basic WebSocket server with connection handling
   - Implement heartbeat/ping-pong for connection health
   - Add graceful shutdown and reconnection logic

2. **Basic Routing Architecture**
   - Define message schema (envelope format with `type`, `channel`, `payload`)
   - Implement router to dispatch messages by type
   - Create handler registry pattern
   - Add basic error handling and logging

3. **Configuration System**
   - Environment-based config (dev/staging/prod)
   - Secret management (Azure Key Vault integration placeholder)
   - Port, host, SSL/TLS certificate configuration

4. **Development Tooling**
   - ESLint, Prettier setup
   - TypeScript configuration
   - Build scripts (dev, build, start)
   - Basic unit test framework (Jest)

### Acceptance Criteria

- [x] WebSocket server accepts connections on configured port
- [x] Clients can connect, send messages, and receive responses
- [x] Connection drops are detected and logged
- [x] Messages route to correct handlers based on type
- [x] Configuration loads from environment variables
- [x] Logs output to console with timestamp and severity

### Estimated Effort

**2-3 days** (1 developer)

### Dependencies

- None (greenfield)

---

## Phase 1: Core Channels (Webchat, Teams)

**Objective:** Implement bidirectional communication for primary channels

### Tasks

1. **Webchat Channel**
   - Create webchat handler module
   - Implement message ingestion from webchat WebSocket
   - Format webchat messages to internal schema
   - Send responses back to webchat clients
   - Handle webchat-specific features (typing indicators, read receipts)

2. **Microsoft Teams Integration**
   - Set up Bot Framework registration in Azure
   - Implement Teams adapter using `botbuilder` SDK
   - Handle Teams activity types (message, conversationUpdate, etc.)
   - Implement proactive messaging (teams-initiated conversations)
   - Teams-specific formatting (Adaptive Cards, mentions, threads)

3. **Channel Abstraction Layer**
   - Define `IChannelAdapter` interface
   - Normalize incoming messages to common format
   - Normalize outgoing messages with channel-specific rendering
   - Channel registry for dynamic handler loading

4. **Message Queue (Optional)**
   - Evaluate need for message queue (RabbitMQ/Azure Service Bus)
   - Implement queue for async message processing
   - Add retry logic for failed deliveries

### Acceptance Criteria

- [x] Webchat clients can send and receive messages
- [x] Teams users can interact with bot in 1:1 and group chats
- [x] Messages from both channels normalize to common schema
- [x] Responses render correctly in each channel (formatting preserved)
- [x] Typing indicators work in webchat
- [x] Teams Adaptive Cards render properly

### Estimated Effort

**5-7 days** (1 developer)

### Dependencies

- Phase 0 complete
- Azure Bot registration (Teams)
- Webchat client implementation (can be basic test client)

---

## Phase 2: LLM Abstraction

**Objective:** Create provider-agnostic LLM interface for multi-model support

### Tasks

1. **LLM Provider Interface**
   - Define `ILLMProvider` interface (chat, streaming, embeddings)
   - Define common message format (role, content, tool_calls)
   - Define provider configuration schema

2. **OpenAI Provider**
   - Implement OpenAI provider using official SDK
   - Support chat completions (GPT-4, GPT-3.5)
   - Support streaming responses
   - Handle function calling format

3. **Anthropic Provider**
   - Implement Anthropic provider (Claude 3.5, Opus)
   - Map Anthropic's message format to internal schema
   - Support streaming
   - Handle tool use (Anthropic's tool format)

4. **Azure OpenAI Provider**
   - Implement Azure OpenAI provider
   - Handle Azure-specific auth (API key, Entra ID)
   - Support deployment-based model selection

5. **Provider Selection Logic**
   - Route-based provider selection (e.g., `/chat/openai`, `/chat/anthropic`)
   - Default provider configuration
   - Model fallback logic (if provider fails, try alternate)

6. **Response Streaming**
   - Implement server-sent events (SSE) for streaming
   - Buffer partial responses for WebSocket delivery
   - Handle stream interruption and resumption

### Acceptance Criteria

- [x] Can send messages to OpenAI and receive responses
- [x] Can send messages to Anthropic and receive responses
- [x] Can send messages to Azure OpenAI and receive responses
- [x] Streaming works for all providers
- [x] Provider failures gracefully handled with fallback
- [x] Tool/function call format normalized across providers

### Estimated Effort

**7-10 days** (1 developer)

### Dependencies

- Phase 0 complete
- API keys for OpenAI, Anthropic, Azure OpenAI
- Phase 1 helpful but not required (can test directly)

---

## Phase 3: Tool Execution

**Objective:** Enable LLM to invoke tools and functions

### Tasks

1. **Tool Registry**
   - Define `ITool` interface (name, description, parameters, execute)
   - Create tool registry for registration and discovery
   - Schema validation for tool parameters (JSON Schema)

2. **MCP (Model Context Protocol) Integration**
   - Integrate MCP client library
   - Discover MCP servers from configuration
   - Map MCP tools to internal tool format
   - Execute MCP tool calls and return results

3. **Azure Functions Integration**
   - HTTP-based Azure Function invocation
   - Authentication (function keys, managed identity)
   - Map Azure Function OpenAPI specs to tool definitions

4. **Built-in Tools**
   - `web_search` (Brave API integration)
   - `web_fetch` (URL content extraction)
   - `datetime` (current date/time)
   - `calculator` (basic math)

5. **Tool Execution Flow**
   - LLM requests tool execution
   - Gateway validates parameters
   - Gateway executes tool (MCP, Azure Function, built-in)
   - Result returned to LLM
   - LLM generates final response

6. **Security & Sandboxing**
   - Tool execution timeout limits
   - Resource usage limits (memory, CPU)
   - Allowlist/denylist for tool access by user/channel

### Acceptance Criteria

- [x] LLM can call MCP tools and receive results
- [x] LLM can call Azure Functions and receive results
- [x] Built-in tools (`web_search`, `web_fetch`) work
- [x] Tool execution failures handled gracefully
- [x] Tool timeouts enforced (30s default)
- [x] Tool access restricted by configuration

### Estimated Effort

**10-14 days** (1 developer)

### Dependencies

- Phase 2 complete (LLM abstraction)
- MCP servers configured (can use mcporter config as reference)
- Azure Functions deployed (optional for initial testing)

---

## Phase 4: Memory & Sessions

**Objective:** Persistent conversation context and multi-turn interactions

### Tasks

1. **Session Management**
   - Define session schema (sessionId, userId, channelId, metadata)
   - Session creation, retrieval, update, deletion
   - Session timeout and cleanup (idle sessions)

2. **Conversation History Storage**
   - Choose storage backend (PostgreSQL, Cosmos DB, Redis)
   - Schema design for messages (user, assistant, system, tool)
   - Efficient retrieval (pagination, filtering by session)
   - Message retention policy (30 days default)

3. **Context Window Management**
   - Token counting per provider
   - Context pruning strategies (sliding window, summarization)
   - Important message pinning (system instructions)

4. **User State & Preferences**
   - User profile storage (name, preferences, settings)
   - Per-user LLM provider preference
   - Per-user tool access permissions
   - User-specific system prompts

5. **Memory Retrieval (RAG)**
   - Vector embeddings for message history
   - Semantic search for relevant context
   - Integration with vector DB (Pinecone, Azure AI Search)

6. **Session Recovery**
   - Resume conversations after disconnect
   - Session migration across devices/channels

### Acceptance Criteria

- [x] Sessions persist across gateway restarts
- [x] Conversation history retrieved correctly
- [x] Context window pruning prevents token limit errors
- [x] User preferences respected (provider, tools)
- [x] Semantic search retrieves relevant past messages
- [x] Sessions timeout after 24h of inactivity

### Estimated Effort

**10-14 days** (1 developer)

### Dependencies

- Phase 2 complete (LLM abstraction)
- Database provisioned (PostgreSQL or Cosmos DB)
- Vector DB provisioned (for RAG feature)

---

## Phase 5: Additional Channels

**Objective:** Expand channel support (Discord, Slack, WhatsApp, etc.)

### Tasks

1. **Discord Integration**
   - Register Discord bot application
   - Implement Discord.js adapter
   - Handle Discord-specific events (messages, reactions, threads)
   - Support Discord embeds, buttons, select menus
   - Role-based permissions

2. **Slack Integration**
   - Register Slack app
   - Implement Slack Bolt adapter
   - Handle Slack events (messages, reactions, slash commands)
   - Support Slack blocks (rich formatting)
   - Workspace-based permissions

3. **WhatsApp Integration**
   - Set up WhatsApp Business API
   - Implement WhatsApp Cloud API adapter
   - Handle text, media, location messages
   - Template message support (for proactive messaging)

4. **Email Channel (via Microsoft Graph)**
   - Implement email polling (inbox monitoring)
   - Parse email threads
   - Send email responses
   - Handle attachments

5. **SMS/Twilio (Optional)**
   - Twilio integration for SMS
   - Handle inbound/outbound SMS
   - MMS support (images)

### Acceptance Criteria

- [x] Discord bot responds to mentions and DMs
- [x] Slack app responds in channels and DMs
- [x] WhatsApp bot handles text and media messages
- [x] Email channel monitors inbox and sends replies
- [x] All channels support common features (text, images, links)

### Estimated Effort

**14-21 days** (1 developer, or parallel with 2 developers: 10-14 days)

### Dependencies

- Phase 1 complete (channel abstraction)
- Phase 4 helpful (session management for multi-channel users)
- Bot registrations for each platform

---

## Phase 6: Production Hardening

**Objective:** Make gateway production-ready with monitoring, security, scaling

### Tasks

1. **Monitoring & Observability**
   - Application Insights integration (Azure)
   - Custom metrics (message volume, latency, errors)
   - Distributed tracing (OpenTelemetry)
   - Alerts for high error rates, downtime

2. **Logging & Auditing**
   - Structured logging (JSON format)
   - Log levels (debug, info, warn, error)
   - Audit log for sensitive operations (tool execution, user data access)
   - Log aggregation (Azure Log Analytics, ELK stack)

3. **Security Hardening**
   - HTTPS/WSS enforcement
   - API authentication (OAuth2, API keys)
   - Rate limiting per user/channel
   - Input validation and sanitization
   - Secrets in Azure Key Vault (no hardcoded keys)
   - RBAC for admin operations

4. **Performance Optimization**
   - Connection pooling (database, HTTP clients)
   - Caching (Redis for session data, LLM responses)
   - Load testing (artillery, k6)
   - Identify and fix bottlenecks

5. **Scalability**
   - Horizontal scaling (multiple gateway instances)
   - Load balancer configuration (Azure App Gateway, nginx)
   - Stateless design (session affinity via Redis)
   - Database connection limits and pooling

6. **Deployment Automation**
   - CI/CD pipeline (GitHub Actions, Azure DevOps)
   - Automated testing (unit, integration, e2e)
   - Blue-green or canary deployments
   - Infrastructure as Code (Bicep, Terraform)

7. **Disaster Recovery**
   - Database backups (automated, daily)
   - Point-in-time recovery
   - Multi-region deployment (optional)
   - Runbook for incident response

8. **Documentation**
   - API documentation (OpenAPI/Swagger)
   - Deployment guide
   - Troubleshooting runbook
   - Architecture diagrams (updated)

### Acceptance Criteria

- [x] Application Insights shows real-time metrics
- [x] Alerts fire for error rate >5% or downtime
- [x] All secrets stored in Key Vault
- [x] Rate limiting prevents abuse (100 req/min/user)
- [x] Load test passes at 1000 concurrent connections
- [x] CI/CD deploys to staging automatically on PR merge
- [x] Database backed up daily, tested restore
- [x] API documentation published and up-to-date

### Estimated Effort

**14-21 days** (1 developer, or parallel tasks with team)

### Dependencies

- All prior phases complete
- Azure resources provisioned (App Insights, Key Vault, etc.)
- Load testing tools configured

---

## Cross-Phase Considerations

### Testing Strategy

- **Unit tests:** Each phase includes unit tests (Jest)
- **Integration tests:** End-to-end tests for each channel + LLM provider
- **Load tests:** Phase 6 (production hardening)
- **Security tests:** Phase 6 (penetration testing, vulnerability scanning)

### Documentation

- **Phase 0:** Basic README, architecture diagram
- **Phase 1-5:** Update README with new channels/features
- **Phase 6:** Full API docs, deployment guide, runbooks

### Code Review

- All PRs require review before merge
- Architectural changes require design review
- Security-sensitive changes require security review

---

## Total Effort Estimate

| Phase | Effort (Days) | Cumulative |
|-------|---------------|------------|
| Phase 0: Foundation | 2-3 | 2-3 |
| Phase 1: Core Channels | 5-7 | 7-10 |
| Phase 2: LLM Abstraction | 7-10 | 14-20 |
| Phase 3: Tool Execution | 10-14 | 24-34 |
| Phase 4: Memory/Sessions | 10-14 | 34-48 |
| Phase 5: Additional Channels | 14-21 | 48-69 |
| Phase 6: Production Hardening | 14-21 | 62-90 |

**Total: 62-90 working days (3-4.5 months for 1 developer, or 1.5-2.5 months with 2-3 developers)**

---

## Milestone Schedule (Example)

| Milestone | Target Date | Deliverables |
|-----------|-------------|--------------|
| M0: Foundation | Week 1 | WebSocket server, basic routing |
| M1: Core Channels | Week 2-3 | Webchat + Teams working |
| M2: LLM Integration | Week 4-5 | Multi-provider LLM support |
| M3: Tool Execution | Week 6-8 | MCP + Azure Functions + built-ins |
| M4: Memory | Week 9-11 | Sessions + history + RAG |
| M5: Channel Expansion | Week 12-15 | Discord, Slack, WhatsApp, Email |
| M6: Production Ready | Week 16-18 | Monitoring, security, scaling |

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| API rate limits (OpenAI, etc.) | High | Medium | Implement caching, fallback providers |
| Channel API changes | Medium | Medium | Abstract channel logic, version APIs |
| Security breach | Low | High | Security reviews, Key Vault, RBAC |
| Database scaling issues | Medium | High | Load test early, plan sharding/replicas |
| MCP server instability | Medium | Low | Timeout handling, graceful degradation |

---

## Future Enhancements (Post-Phase 6)

- **Voice channels:** Integrate voice (Twilio Voice, Teams calling)
- **Multimodal:** Image generation, vision (GPT-4V, DALL-E)
- **Agent orchestration:** Multi-agent workflows, subagent spawning
- **Custom plugins:** User-defined tools/plugins
- **Analytics dashboard:** Usage metrics, conversation insights
- **A/B testing:** Test different prompts/providers
- **Compliance:** GDPR, HIPAA compliance features

---

## Appendix

### Technology Stack

- **Runtime:** Node.js 22+, TypeScript 5+
- **WebSocket:** `ws` library
- **HTTP:** Express.js
- **Database:** PostgreSQL (sessions, history) + Redis (cache)
- **Vector DB:** Pinecone or Azure AI Search (RAG)
- **LLM SDKs:** `openai`, `@anthropic-ai/sdk`, `@azure/openai`
- **Channels:** `botbuilder` (Teams), `discord.js`, `@slack/bolt`, WhatsApp Cloud API
- **Tools:** MCP client, Axios (Azure Functions)
- **Monitoring:** Azure Application Insights, Winston (logging)
- **Deployment:** Azure App Service or Container Apps

### References

- [Phoenix Echo Gateway README](../README.md)
- [MCP Specification](https://github.com/anthropics/mcp)
- [Bot Framework SDK](https://github.com/microsoft/botbuilder-js)
- [Discord.js Guide](https://discordjs.guide)
- [Slack Bolt Documentation](https://slack.dev/bolt-js)

---

**End of Roadmap**
