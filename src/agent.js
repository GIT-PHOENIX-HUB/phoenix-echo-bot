/**
 * Phoenix Echo Agent Runner
 *
 * Handles the agent loop:
 * 1. Send messages to Claude
 * 2. If Claude wants to use tools, execute them
 * 3. Feed results back to Claude
 * 4. Repeat until Claude returns text (no tool use)
 */

import Anthropic from '@anthropic-ai/sdk';

function sleep(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function sleepWithJitter(baseMs, jitterFraction = 0.5) {
  const jitter = Math.floor(Math.random() * baseMs * jitterFraction);
  return sleep(baseMs + jitter);
}

function isRetriableError(error) {
  const status = Number(error?.status);
  if (status === 429 || status >= 500) {
    return true;
  }
  const code = String(error?.code || '').toUpperCase();
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN';
}

export class AgentRunner {
  constructor(options = {}) {
    this.client = new Anthropic(options.clientOptions || {});
    this.systemPrompt = options.systemPrompt || 'You are a helpful assistant.';
    this.tools = options.tools || [];
    this.executeToolCall = options.executeToolCall;
    this.model = options.model || 'claude-sonnet-4-5-20250929';
    this.maxTokens = options.maxTokens || 4096;
    this.maxToolIterations = options.maxToolIterations || 20;
    this.maxRequestRetries = Number.isFinite(Number(options.maxRequestRetries))
      ? Math.max(0, Math.floor(Number(options.maxRequestRetries)))
      : 3;
    this.retryBaseDelayMs = Number.isFinite(Number(options.retryBaseDelayMs))
      ? Math.max(100, Math.floor(Number(options.retryBaseDelayMs)))
      : 500;
    this.maxConsecutiveToolErrors = Number.isFinite(Number(options.maxConsecutiveToolErrors))
      ? Math.max(1, Math.floor(Number(options.maxConsecutiveToolErrors)))
      : 3;
    this.logger = typeof options.logger === 'function' ? options.logger : null;
  }

  log(level, event, meta = {}) {
    if (this.logger) {
      this.logger(level, event, meta);
      return;
    }
    const payload = { ts: new Date().toISOString(), level, event, ...meta };
    const line = JSON.stringify(payload);
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  /**
   * Convert our tool format to Anthropic's format
   */
  formatTools() {
    return this.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema
    }));
  }

  async createMessageWithRetry(payload, context = {}) {
    let attempt = 0;
    while (attempt <= this.maxRequestRetries) {
      try {
        return await this.client.messages.create(payload);
      } catch (error) {
        if (!isRetriableError(error) || attempt >= this.maxRequestRetries) {
          throw error;
        }
        const delayMs = this.retryBaseDelayMs * (2 ** attempt);
        this.log('warn', 'model_request_retry', {
          requestId: context.requestId || null,
          attempt: attempt + 1,
          nextDelayMs: delayMs,
          status: error?.status || null,
          code: error?.code || null,
          message: error?.message || 'retryable error'
        });
        await sleepWithJitter(delayMs);
        attempt += 1;
      }
    }
    throw new Error('Unexpected retry loop termination');
  }

  /**
   * Run the agent loop
   * @param {Array} messages - Conversation history
   * @returns {{text:string, generatedTurns:Array<{role:string, content:any}>, stopReason:string}}
   */
  async run(messages, context = {}) {
    let iteration = 0;
    let currentMessages = [...messages];
    const generatedTurns = [];
    let consecutiveToolErrors = 0;

    while (iteration < this.maxToolIterations) {
      iteration++;
      this.log('info', 'agent_iteration_start', {
        requestId: context.requestId || null,
        iteration
      });

      // Call Claude
      const response = await this.createMessageWithRetry({
        model: this.model,
        max_tokens: this.maxTokens,
        system: this.systemPrompt,
        tools: this.formatTools(),
        messages: currentMessages
      }, context);

      this.log('info', 'agent_iteration_result', {
        requestId: context.requestId || null,
        iteration,
        stopReason: response.stop_reason
      });

      // If Claude is done (no tool use), extract text and return
      if (response.stop_reason === 'end_turn') {
        const textContent = response.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('');

        const assistantTurn = {
          role: 'assistant',
          content: response.content
        };
        generatedTurns.push(assistantTurn);
        currentMessages.push(assistantTurn);

        return {
          text: textContent,
          generatedTurns,
          stopReason: 'end_turn'
        };
      }

      // If Claude wants to use tools
      if (response.stop_reason === 'tool_use') {
        // Add assistant message with tool_use blocks
        const assistantToolTurn = {
          role: 'assistant',
          content: response.content
        };
        currentMessages.push(assistantToolTurn);
        generatedTurns.push(assistantToolTurn);

        // Process each tool use
        const toolResults = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            this.log('info', 'tool_call_start', {
              requestId: context.requestId || null,
              iteration,
              tool: block.name
            });

            try {
              const result = await this.executeToolCall(block.name, block.input);
              consecutiveToolErrors = 0;
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: String(result)
              });
              this.log('info', 'tool_call_success', {
                requestId: context.requestId || null,
                iteration,
                tool: block.name
              });
            } catch (error) {
              consecutiveToolErrors += 1;
              this.log('error', 'tool_call_error', {
                requestId: context.requestId || null,
                iteration,
                tool: block.name,
                consecutiveErrors: consecutiveToolErrors,
                message: error.message
              });
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Error: ${error.message}`,
                is_error: true
              });
            }
          }
        }

        // Add tool results as user message
        const toolResultTurn = {
          role: 'user',
          content: toolResults
        };
        currentMessages.push(toolResultTurn);
        generatedTurns.push(toolResultTurn);

        // Three-failure rule: stop if too many consecutive tool errors
        if (consecutiveToolErrors >= this.maxConsecutiveToolErrors) {
          this.log('warn', 'agent_consecutive_tool_errors', {
            requestId: context.requestId || null,
            consecutiveToolErrors,
            maxConsecutiveToolErrors: this.maxConsecutiveToolErrors
          });
          const tooManyErrorsText =
            `Tool execution failed ${consecutiveToolErrors} times in a row. Stopping to avoid further errors. Please check the tool configuration or try a different approach.`;
          generatedTurns.push({
            role: 'assistant',
            content: [{ type: 'text', text: tooManyErrorsText }]
          });
          return {
            text: tooManyErrorsText,
            generatedTurns,
            stopReason: 'max_consecutive_tool_errors'
          };
        }
      }
    }

    // If we hit max iterations
    this.log('warn', 'agent_iteration_limit', {
      requestId: context.requestId || null,
      maxToolIterations: this.maxToolIterations
    });
    const fallbackText =
      "I've been working on this but hit my iteration limit. Let me know if you'd like me to continue.";
    generatedTurns.push({
      role: 'assistant',
      content: [{ type: 'text', text: fallbackText }]
    });
    return {
      text: fallbackText,
      generatedTurns,
      stopReason: 'max_iterations'
    };
  }
}

export default AgentRunner;
