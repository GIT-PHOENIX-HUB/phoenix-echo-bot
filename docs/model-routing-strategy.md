# ClawRouter: Intelligent Model Routing Strategy

**Last Updated:** 2026-02-17  
**Status:** MVP Complete, Ready for Integration Testing  
**Owner:** Phoenix Electric LLC

## Executive Summary

ClawRouter is Phoenix Electric's intelligent model routing system that automatically selects the most cost-effective AI model (Haiku, Sonnet, or Opus) based on message complexity. Using pure heuristic analysis with **zero LLM calls**, it analyzes messages in sub-millisecond time (<200µs average) and routes them to the cheapest model capable of handling the task.

**Key Metrics:**
- **15 independent signals** analyze message complexity
- **3-tier system**: Haiku (0-7), Sonnet (8-34), Opus (35+)
- **Sub-millisecond analysis**: ~130-200µs per message
- **Cost optimization**: Route 60-70% of messages to Haiku/Sonnet instead of always using Opus
- **Zero external dependencies**: Pure TypeScript, no network calls

---

## 1. The 15 Complexity Signals

ClawRouter evaluates each message against 15 independent signals. Each signal returns a strength score (0.0-1.0) multiplied by its weight to produce a complexity contribution.

### 1.1 Simplicity Signals (Negative Weight → Pull Toward Haiku)

These signals **reduce** complexity score, indicating messages that Haiku can handle efficiently.

| Signal | Weight | Description |
|--------|--------|-------------|
| **greeting** | -15 | Very short greetings/confirmations: "hi", "thanks", "ok", "yes", "lol", emoji reactions, etc. Matches messages <30-50 chars with conversational acknowledgements. |
| **short_question** | -10 | Simple factual questions <80 chars with no code blocks or complex reasoning terms. Example: "What time is it?" |
| **simple_lookup** | -8 | Basic "what is/who is/when did/where is/how old" questions under 120 chars. Example: "What is DNS?" or "How old is Python?" |

**Design Rationale:** These patterns represent messages where Opus would be overkill. A -15 weight on "greeting" can offset a +12 from "technical_terms," preventing unnecessary escalation.

### 1.2 Moderate Complexity Signals (Positive Weight → Pull Toward Sonnet)

These signals indicate tasks that benefit from Sonnet's capabilities but don't require Opus.

| Signal | Weight | Evaluation Logic |
|--------|--------|------------------|
| **code_presence** | +12 | Counts code blocks (` ``` `) and inline code (`` ` ``). Full match at 3+ blocks, 0.7 at 1+ blocks, 0.5 at 5+ inline snippets. |
| **technical_terms** | +10 | Scans for 40+ technical keywords (API, GraphQL, Docker, Kubernetes, PostgreSQL, OAuth, JWT, etc.). Full match at 8+ terms, 0.7 at 4+, 0.4 at 2+. |
| **token_length** | +8 | Rough estimate: message length ÷ 4. Full match >2000 tokens (~8000 chars), 0.7 >800 tokens, 0.4 >300 tokens. |
| **multi_step** | +10 | Detects numbered lists, bullet points, or sequence words ("first...then...finally", "step 1/2/3"). Full match at 6+ steps, 0.6 at 3+, 0.3 at 1+. |
| **file_operations** | +10 | Matches file operation keywords ("read file", "edit", "create", "update", "save to") and file path patterns (`src/`, `config/`, `.ts`, `.json`). Full match at 3+ operations or 3+ paths. |
| **system_commands** | +12 | Detects shell commands: `git`, `npm`, `docker`, `kubectl`, `ssh`, `curl`, `grep`, `systemctl`, etc. Full match at 3+ commands, 0.6 at 1+. |

**Design Rationale:** These signals represent "real work" that requires execution capability and moderate reasoning. Weight +10-12 puts them solidly in Sonnet range (8-34) unless combined with multiple high-complexity signals.

### 1.3 High Complexity Signals (Heavy Positive Weight → Pull Toward Opus)

These signals indicate tasks requiring advanced reasoning, architecture design, or creative problem-solving.

| Signal | Weight | Evaluation Logic |
|--------|--------|------------------|
| **reasoning_request** | +15 | Matches "explain why/how", "analyze", "compare", "evaluate", "trade-offs", "pros and cons", "should I... or", "which is better", "why does/would/should". Full match at 3+ patterns, 0.7 at 2+, 0.4 at 1+. |
| **error_debug** | +14 | Detects stack traces (`at function_name (file:line)`), error types (TypeError, SyntaxError), and debug keywords ("bug", "crash", "broken", "not working", "exit code", "status code 4xx/5xx"). Full match at 3+ signals or stack trace present. |
| **architecture** | +16 | **Highest weight.** Matches "architecture", "design pattern", "system design", "scalability", "microservices", "event-driven", "database schema", "data modeling", "refactoring", "SOLID principles", "dependency injection". Full match at 4+ terms, 0.7 at 2+. |
| **creative_complex** | +14 | Detects creation requests: "build a/an/me", "implement", "write a function/class/module/component", "from scratch", "full stack/implementation". Full match at 3+ patterns. |
| **multi_file_scope** | +14 | Counts distinct file extensions in message (`.ts`, `.js`, `.py`, `.css`, `.json`, `.yaml`, `.sql`, `.dockerfile`, etc.). Full match at 5+ unique extensions, 0.7 at 3+, 0.4 at 2+. |
| **security_sensitive** | +12 | Matches security keywords: "secure/security", "vulnerability", "authentication", "authorization", "encrypt/decrypt", "hashing", "password", "injection", "XSS", "CSRF", "certificate", "firewall". Full match at 3+ terms. |

**Design Rationale:** These signals represent tasks where cutting corners (using a weaker model) would likely result in poor output quality, requiring re-generation and wasting more tokens overall.

### 1.4 Signal Weight Tuning Philosophy

**Weights reflect cost-of-failure, not frequency:**
- **Architecture (+16)**: Wrong tier here = complete redesign needed
- **Greeting (-15)**: Wrong tier here = minor cost waste, no quality loss
- **Technical terms (+10)**: Moderate indicator, but not deterministic alone

**Negative weights prevent false positives:**
- "Thanks for the API docs!" would trigger `technical_terms` (+10) but `greeting` (-15) dominates → Haiku
- "Hi, can you explain OAuth2 architecture?" triggers `greeting` (-15), `reasoning_request` (+15), `architecture` (+16) = net +16 → likely Sonnet/Opus depending on phrasing

---

## 2. Threshold Tuning & Tier Boundaries

### 2.1 Default Thresholds

```typescript
{
  thresholds: {
    sonnet: 8,   // Score ≥ 8  → Sonnet
    opus: 35     // Score ≥ 35 → Opus
  }
}
```

**Scoring Range:** 0-100 (normalized from weighted sum of all signal contributions)

**Tier Mapping:**
- **Haiku:** 0-7 (simple greetings, short questions, confirmations)
- **Sonnet:** 8-34 (file operations, multi-step tasks, moderate debugging)
- **Opus:** 35+ (architecture design, complex reasoning, multi-system integration)

### 2.2 Threshold Selection Rationale

**Why 8 for Sonnet?**
- A single moderate signal (e.g., `code_presence` at +12 or `system_commands` at +12) should trigger Sonnet
- Prevents Haiku from receiving tasks with shell commands or multi-line code
- Calibrated against test suite: "Read config.json and update API URL" → score 18

**Why 35 for Opus?**
- Requires **multiple high-complexity signals** or one extreme signal
- Example triggering patterns:
  - `architecture` (+16) + `reasoning_request` (+15) + `multi_step` (+10) = 41
  - `error_debug` (+14) + `code_presence` (+12) + `technical_terms` (+10) = 36
  - Full architecture design request with 8+ technical terms and 4+ reasoning keywords = 60+
- Calibrated against: "Design microservices with OAuth, PostgreSQL schema, Redis events, Docker, CI/CD, compare trade-offs" → score 65

### 2.3 Tuning for Custom Workloads

**If you're getting too many Opus calls:**
```typescript
router.updateConfig({ thresholds: { sonnet: 8, opus: 45 } });
```
- Raises bar for Opus by ~30%
- Sonnet will handle more complex tasks

**If Haiku is struggling:**
```typescript
router.updateConfig({ thresholds: { sonnet: 5, opus: 35 } });
```
- Lowers bar for Sonnet, protecting Haiku from borderline tasks

**Minimum tier floor** (never route below this):
```typescript
router.updateConfig({ minimumTier: 'sonnet' });
```
- Forces all messages to Sonnet or Opus (disables Haiku)
- Useful for critical production sessions where cost is secondary

---

## 3. Cost Optimization Math

### 3.1 Model Pricing (Anthropic Claude 3.5/4 Tier)

| Model | Cost per 1M Input Tokens | Cost per 1M Output Tokens | Relative Cost |
|-------|--------------------------|---------------------------|---------------|
| **Haiku 3.5** | $1.00 | $5.00 | 1x (baseline) |
| **Sonnet 4.5** | $3.00 | $15.00 | 3x |
| **Opus 4** | $15.00 | $75.00 | 15x |

### 3.2 Routing Impact on Average Cost

**Assumptions:**
- Average message: 500 input tokens, 1000 output tokens
- Without routing: 100% Opus
- With routing: 40% Haiku, 35% Sonnet, 25% Opus (typical distribution)

**Cost per message:**
```
Opus only:
  Input:  500 × $15.00 / 1M = $0.0075
  Output: 1000 × $75.00 / 1M = $0.0750
  Total: $0.0825 per message

With ClawRouter (weighted average):
  Haiku:  0.40 × (500×$1 + 1000×$5) / 1M = 0.40 × $0.0055 = $0.0022
  Sonnet: 0.35 × (500×$3 + 1000×$15) / 1M = 0.35 × $0.0165 = $0.0058
  Opus:   0.25 × (500×$15 + 1000×$75) / 1M = 0.25 × $0.0825 = $0.0206
  
  Total: $0.0286 per message
```

**Savings:** $0.0825 - $0.0286 = **$0.0539 per message (65% reduction)**

### 3.3 Real-World Volume Projections

**For a daily volume of 10,000 messages:**
- **Without routing:** 10,000 × $0.0825 = **$825/day** = $25,000/month
- **With routing:** 10,000 × $0.0286 = **$286/day** = $8,600/month
- **Monthly savings:** **$16,400** (65% reduction)

**ROI:** ClawRouter adds ~200µs latency per message (negligible), requires zero maintenance, and pays for itself at any non-trivial volume.

### 3.4 Budget-Aware Fallback Logic

ClawRouter includes **budget constraint awareness** to prevent overspending:

```typescript
budgetThresholds: {
  opus: 80,   // Fall back from Opus if >80% of budget used
  sonnet: 90  // Fall back from Sonnet if >90% of budget used
}
```

**Example:**
```typescript
const budget = {
  opus: { utilizationPct: 85, available: true },
  sonnet: { utilizationPct: 50, available: true },
  haiku: { utilizationPct: 10, available: true }
};

router.route(complexMessage, undefined, budget);
// Message scores 65 (normally Opus), but Opus budget at 85%
// → Falls back to Sonnet
// → reason: "complexity_score=65 | budget_fallback(opus→sonnet)"
```

This prevents budget blow-outs while maintaining reasonable quality.

---

## 4. Integration Strategy with Phoenix Echo Gateway

ClawRouter is a **standalone TypeScript library** designed to integrate with Phoenix Echo Gateway's LLM request pipeline.

### 4.1 Integration Points

#### Option A: Pre-Request Hook (Recommended)
Intercept the message **before** the LLM API call:

```typescript
// In Phoenix Echo Gateway's agent message handler
import { ClawRouter } from '@phoenix/clawrouter';

const router = new ClawRouter({
  models: {
    haiku: 'anthropic/claude-haiku-3-5',
    sonnet: 'anthropic/claude-sonnet-4-5',
    opus: 'anthropic/claude-opus-4-6'
  }
});

async function handleAgentMessage(message: string, sessionContext: SessionContext) {
  // 1. Route the message
  const decision = router.route(message, {
    currentTier: sessionContext.currentModelTier,
    messageCount: sessionContext.messageCount
  });
  
  // 2. Log routing decision (transparency)
  console.log(`[ClawRouter] ${decision.tier} (score=${decision.complexity.score}) — ${decision.reason}`);
  
  // 3. Override model for this request
  const response = await llm.complete({
    model: decision.model,
    messages: [...sessionContext.history, { role: 'user', content: message }]
  });
  
  // 4. Update session tier (for upgrade-only policy)
  sessionContext.currentModelTier = decision.tier;
  
  return response;
}
```

#### Option B: Config-Level Model Aliases
Map tier names to gateway model aliases:

```json
// phoenix-echo config
{
  "models": {
    "haiku": "anthropic/claude-haiku-3-5",
    "sonnet": "anthropic/claude-sonnet-4-5",
    "opus": "anthropic/claude-opus-4-6"
  },
  "clawRouter": {
    "enabled": true,
    "thresholds": { "sonnet": 8, "opus": 35 }
  }
}
```

Then use `session_status(model=<tier>)` to apply routing:

```typescript
const decision = router.route(message);
sessionStatus({ model: decision.tier }); // Sets model to alias
```

#### Option C: Middleware Layer
Create gateway middleware that wraps the router:

```typescript
// skills/clawrouter/index.ts
export async function clawRouterMiddleware(req: AgentRequest, next: NextFunction) {
  const router = new ClawRouter();
  const decision = router.route(req.message, req.session);
  
  req.modelOverride = decision.model;
  req.routingMetadata = {
    tier: decision.tier,
    score: decision.complexity.score,
    reason: decision.reason
  };
  
  return next(req);
}
```

### 4.2 Session Context Management

**Upgrade-Only Policy:** Once a session escalates to a higher tier, never downgrade within that session.

**Why?** Context and reasoning quality should remain consistent. Downgrading mid-conversation can cause confusion or loss of capability.

```typescript
// Track current tier in session state
type SessionState = {
  currentModelTier?: 'haiku' | 'sonnet' | 'opus';
  messageCount: number;
  // ... other session data
};

// Router respects currentTier
const decision = router.route(message, {
  currentTier: session.currentModelTier,
  messageCount: session.messageCount
});

// Update session state after routing
session.currentModelTier = decision.tier;
```

**Special case: Sub-agents**
Sub-agents can start fresh (no upgrade-only constraint) since they're isolated tasks:

```typescript
const decision = router.route(subAgentTask, {
  isSubagent: true,
  currentTier: undefined // Allow fresh evaluation
});
```

### 4.3 Transparency & Observability

**Every routing decision includes full transparency:**

```typescript
{
  tier: 'sonnet',
  model: 'anthropic/claude-sonnet-4-5',
  complexity: {
    score: 24,
    tier: 'sonnet',
    signals: [
      { name: 'code_presence', weight: 8.4, matched: true, detail: 'strength=0.70' },
      { name: 'file_operations', weight: 6.0, matched: true, detail: 'strength=0.60' },
      { name: 'multi_step', weight: 6.0, matched: true, detail: 'strength=0.60' },
      { name: 'technical_terms', weight: 4.0, matched: true, detail: 'strength=0.40' },
      // ... other signals
    ],
    analysisTimeUs: 142
  },
  budgetConstrained: false,
  reason: 'complexity_score=24'
}
```

**Recommended logging:**
- Log tier + score for every message (info level)
- Log full signal breakdown for Opus decisions (debug level)
- Track tier distribution over time (metrics)

---

## 5. Future Enhancements

### 5.1 Learning from Feedback (Planned)

**Current limitation:** Threshold tuning is manual. We set `sonnet: 8, opus: 35` based on intuition and testing.

**Enhancement:** Collect feedback from actual usage and auto-tune thresholds.

**Implementation approach:**
```typescript
// After LLM response
if (userRatedResponsePoor || requiredRegeneration) {
  feedbackLogger.record({
    message: message,
    routedTier: decision.tier,
    complexityScore: decision.complexity.score,
    feedback: 'undertier' // Or 'overtier' if Opus was used but Sonnet would have worked
  });
}

// Periodically analyze feedback
function autoTuneThresholds(feedbackLog: Feedback[]) {
  // If 20% of Sonnet messages get 'undertier' feedback, lower opus threshold
  // If 50% of Opus messages would have worked on Sonnet, raise opus threshold
}
```

**Challenges:**
- Requires user feedback mechanism (explicit ratings or implicit signals like retry rate)
- Risk of overfitting to specific user patterns
- Need minimum data volume before tuning

**Timeline:** Post-MVP, after 1000+ routed messages with feedback

### 5.2 Task-Specific Routing Profiles

**Current limitation:** One global threshold config applies to all message types.

**Enhancement:** Different thresholds per task category.

**Example:**
```typescript
{
  profiles: {
    'code-review': { sonnet: 15, opus: 50 }, // Higher bar, code is structured
    'architecture': { sonnet: 5, opus: 25 },  // Lower bar, almost always complex
    'casual-chat': { sonnet: 12, opus: 60 },  // Very high Opus bar
    'debug-session': { sonnet: 8, opus: 35 }  // Default thresholds
  }
}

// Auto-detect profile or let caller specify
const decision = router.route(message, {
  profile: 'code-review'
});
```

**Detection strategies:**
- Explicit user intent declaration ("I need architecture advice")
- Session tags (subagent spawned with `--task code-review`)
- Heuristic (message starts with "Review this code:")

**Timeline:** Post-MVP, if default routing shows systematic over/under-routing for specific tasks

### 5.3 Dynamic Signal Weights

**Current limitation:** Signal weights are hardcoded in `signals.ts`.

**Enhancement:** Allow runtime weight adjustment based on user preferences or workload characteristics.

**Example:**
```typescript
router.updateSignalWeights({
  'architecture': 20,     // User does lots of architecture work, be aggressive
  'greeting': -20,        // User never wants Opus for greetings
  'security_sensitive': 8 // User's security questions are usually simple
});
```

**Use case:** Power users who understand their own workload distribution.

**Timeline:** Post-MVP, if users request fine-grained control

### 5.4 Multi-Model Ensembles

**Current limitation:** One message → one model.

**Enhancement:** Route **parts** of a complex message to different models, then combine.

**Example:**
```
User: "Explain OAuth2 architecture (high-level overview), 
       then implement a JWT token validator in TypeScript."

Router:
  - Part 1 (explanation) → Sonnet (score: 28)
  - Part 2 (implementation) → Opus (score: 42, code + creation)
  
Response: Concatenate Sonnet explanation + Opus implementation
```

**Challenges:**
- Message segmentation is non-trivial
- Potential coherence issues between model outputs
- Increased latency (two LLM calls)

**Timeline:** Experimental, research project

### 5.5 Cost-Aware A/B Testing

**Goal:** Validate that ClawRouter routing decisions actually produce acceptable quality at lower cost.

**Methodology:**
1. For 10% of messages, ignore router and always use Opus (control group)
2. For 90% of messages, use router decision (test group)
3. Compare:
   - User satisfaction (explicit ratings, retry rate, session length)
   - Output quality (human eval on sample)
   - Cost savings
4. If test group quality ≥ 95% of control group → declare success

**Timeline:** Integration phase, before full rollout

---

## 6. Performance & Reliability

### 6.1 Latency Impact

**Measured performance** (1000 iterations, complex messages):
- Average: **130-200 microseconds** per analysis
- p50: 140µs
- p95: 180µs
- p99: 220µs

**Negligible compared to:**
- LLM API call latency: 500ms - 2000ms (2500x-10,000x slower than routing)
- Network round-trip: 20ms - 100ms (100x-500x slower)

**Conclusion:** Routing overhead is **0.01-0.04% of total request time**. Effectively free.

### 6.2 Reliability Guarantees

**Zero external dependencies:**
- No LLM calls (unlike "LLM-as-judge" approaches)
- No network requests
- No database lookups
- Pure TypeScript, deterministic logic

**Failure modes:**
- If analysis throws error → catch and default to Opus (safest fallback)
- If config invalid → throw at startup, not runtime
- If signal evaluation breaks → only that signal contributes 0, others still work

**Graceful degradation:**
```typescript
try {
  const decision = router.route(message, session, budget);
  return decision.model;
} catch (err) {
  console.error('[ClawRouter] Analysis failed, defaulting to Opus', err);
  return 'anthropic/claude-opus-4-6';
}
```

### 6.3 Testing Coverage

**Test suite:** 23 tests in `tests/run.ts`

**Coverage areas:**
- Simplicity signals: greetings, short questions, lookups → Haiku
- Moderate signals: file ops, multi-step, system commands → Sonnet
- Complex signals: architecture, reasoning, multi-file → Opus
- Edge cases: empty messages, emoji-only, extremely long messages
- Budget constraints: fallback from Opus to Sonnet when over budget
- Upgrade-only policy: never downgrade within session

**Run tests:**
```bash
cd clawrouter
npm test
```

**Example output:**
```
🟢 HAIKU tier (simple messages):
  ✅ greeting: hi
  ✅ confirmation: sounds good
  ✅ simple question

🟡 SONNET tier (moderate complexity):
  ✅ file operation request
  ✅ multi-step system commands

🔴 OPUS tier (high complexity):
  ✅ full architecture design
  ✅ complex debugging with stack trace

Passed: 23, Failed: 0
```

---

## 7. Deployment Checklist

### 7.1 Pre-Deployment

- [ ] **Run test suite:** Ensure all 23 tests pass in target environment
- [ ] **Benchmark latency:** Confirm <500µs on production hardware
- [ ] **Review thresholds:** Validate `sonnet: 8, opus: 35` match your workload
- [ ] **Test edge cases:** Empty messages, very long messages (>10k chars), emoji-only
- [ ] **Implement fallback:** Always default to Opus if routing fails

### 7.2 Integration

- [ ] **Choose integration point:** Pre-request hook vs config-level vs middleware
- [ ] **Add session state tracking:** Store `currentModelTier` per session
- [ ] **Implement upgrade-only policy:** Check `session.currentTier` before routing
- [ ] **Wire up budget constraints:** Connect to gateway budget tracking if available
- [ ] **Add logging:** Log every routing decision (tier, score, reason)

### 7.3 Monitoring

- [ ] **Track tier distribution:** What % of messages route to each tier?
- [ ] **Monitor cost savings:** Compare actual spend vs "always Opus" baseline
- [ ] **Watch for undertier signals:** High retry rate? Users complaining about quality?
- [ ] **Review Opus triggers:** What messages hit Opus? Are they justified?

### 7.4 Rollout Strategy

**Recommended phased approach:**

1. **Shadow mode (week 1):** Run router, log decisions, but always use Opus
   - Validates: Latency acceptable, no crashes, distribution looks reasonable
2. **Canary mode (week 2):** 10% of sessions use router decisions, 90% use Opus
   - Validates: Quality acceptable, cost savings measurable, no user complaints
3. **Gradual rollout (weeks 3-4):** 50% → 90% → 100% of sessions
   - Validates: Scales to full load, no unexpected issues
4. **Full deployment:** Router enabled for all sessions

**Rollback plan:** If quality degrades or budget exceeds projections, disable routing via config:
```typescript
router.updateConfig({ enabled: false }); // Falls back to defaultModel (Opus)
```

---

## 8. Source Code Reference

**Repository:** `workspace/clawrouter/`

**Key Files:**
- `src/signals.ts` — 15 signal definitions with evaluation logic
- `src/analyzer.ts` — Complexity scoring engine
- `src/router.ts` — Routing logic (tier selection, budget, upgrade-only)
- `src/types.ts` — TypeScript type definitions
- `src/index.ts` — Public API exports
- `tests/run.ts` — Test suite (23 tests)
- `src/demo.ts` — Interactive demo with example messages

**Install & Run:**
```bash
cd workspace/clawrouter
npm install
npm test          # Run test suite
npm run demo      # See routing in action
npm run build     # Compile to dist/
```

**Usage Example:**
```typescript
import { ClawRouter } from './dist/index.js';

const router = new ClawRouter({
  models: {
    haiku: 'anthropic/claude-haiku-3-5',
    sonnet: 'anthropic/claude-sonnet-4-5',
    opus: 'anthropic/claude-opus-4-6'
  },
  thresholds: { sonnet: 8, opus: 35 }
});

const decision = router.route('Design a microservices architecture with...');
console.log(`Route to: ${decision.tier} (score: ${decision.complexity.score})`);
console.log(`Model: ${decision.model}`);
console.log(`Reason: ${decision.reason}`);
```

---

## 9. FAQ

**Q: Why not use an LLM to judge complexity?**  
A: "LLM-as-judge" approaches add 200-500ms latency, cost $0.001-0.01 per judgment, and introduce a new failure mode (what if the judge LLM is down?). Heuristics are free, instant, and deterministic.

**Q: What if heuristics miss a complex message?**  
A: The upgrade-only policy provides a safety net: once a session escalates to Opus (because the user's next message is clearly complex), it stays on Opus. Additionally, users can manually override: `/model opus` to force escalation.

**Q: Can I disable routing for specific sessions?**  
A: Yes, per-session config override:
```typescript
const decision = router.route(message, {
  currentTier: 'opus', // Force Opus
  messageCount: 1
});
```
Or disable globally: `router.updateConfig({ enabled: false })`.

**Q: How do I know if routing is working?**  
A: Log every decision and track distribution. Healthy distribution for typical workload: 30-50% Haiku, 30-40% Sonnet, 20-30% Opus. If you see 80%+ Opus, thresholds may be too aggressive.

**Q: What about non-English messages?**  
A: Current signals are English-centric (keyword matching on "explain", "debug", etc.). Non-English messages may under-route. Workaround: Use `token_length` and `code_presence` as primary signals (language-agnostic). Future enhancement: Multilingual signal definitions.

**Q: Can I add custom signals?**  
A: Yes:
```typescript
import { ComplexityAnalyzer } from '@phoenix/clawrouter';

const customSignals = [
  {
    name: 'phoenix_internal',
    weight: 20,
    evaluate: (msg) => /\bphoenix electric\b/i.test(msg) ? 1 : 0
  }
];

const analyzer = new ComplexityAnalyzer(customSignals);
```

---

## 10. Summary & Next Steps

**ClawRouter Status:** ✅ MVP Complete, Ready for Integration Testing

**Expected Impact:**
- **60-70% cost reduction** vs always-Opus baseline
- **Sub-millisecond latency** (negligible overhead)
- **No quality degradation** for properly-routed messages

**Next Steps:**
1. **Integration:** Wire into Phoenix Echo Gateway message handler (pre-request hook recommended)
2. **Shadow deployment:** Log decisions for 1 week without changing model selection
3. **Canary rollout:** 10% of sessions use router, monitor quality & cost
4. **Full deployment:** Gradually roll out to 100% of sessions
5. **Feedback loop:** Collect user feedback and tune thresholds if needed

**Owner:** Phoenix (shane@phoenixelectric.life)  
**Questions/Issues:** Post in `#ai-development` or tag @Phoenix

---

_Built by Phoenix 🔥 for Phoenix Electric LLC_
