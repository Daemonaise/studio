# Karasawa Labs — Multi-LLM Agent Implementation Guide

## Overview

This document specifies how to implement gstack-style specialist agent workflows into the Karasawa Labs codebase (`Daemonaise/studio`), using three LLM providers (Claude, Codex/OpenAI, Gemini) with automatic load balancing to stay under rate limits.

The goal: six slash-command agents — each a specialist — that can autonomously audit, test, fix, and ship improvements to the Karaslice geometry pipeline and the broader Karasawa Labs platform. Each agent routes its API calls through a load balancer that distributes work across providers based on real-time rate limit headroom.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude Code CLI (developer terminal)                           │
│                                                                 │
│  /plan-ceo     /plan-eng     /review     /ship     /browse      │
│  /reconstruct                                                   │
│                                                                 │
│  Each skill reads its SKILL.md → sets persona + constraints     │
│  → invokes LLM calls through the load balancer                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  LLM Load Balancer (src/lib/llm-balancer.ts)                    │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Claude     │  │   Gemini    │  │   Codex     │             │
│  │  Sonnet 4    │  │  2.5 Flash  │  │  (OpenAI)   │             │
│  │             │  │             │  │             │             │
│  │ RPM: 50     │  │ RPM: 1000   │  │ RPM: 60     │             │
│  │ TPM: 80K    │  │ TPM: 1M     │  │ TPM: 90K    │             │
│  │ Window: 60s │  │ Window: 60s │  │ Window: 60s │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  Strategy:                                                      │
│  1. Check headroom on preferred provider for this task           │
│  2. If headroom > 30%, use preferred provider                   │
│  3. If headroom < 30%, fall to next provider in priority order  │
│  4. If all providers exhausted, queue and retry after cooldown  │
│                                                                 │
│  Task → Provider routing:                                       │
│  - Mesh analysis / code review / architecture → Claude          │
│  - Fast classification / bulk triage / screening → Gemini       │
│  - Code generation / refactoring / large edits → Codex          │
│  - Fallback for any → whichever has most headroom               │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure

Add these files to the existing repo:

```
.claude/
├── skills/
│   ├── plan-ceo-review/SKILL.md      # Founder/CEO mode
│   ├── plan-eng-review/SKILL.md      # Eng manager mode
│   ├── review/SKILL.md               # Paranoid staff engineer mode
│   ├── ship/SKILL.md                 # Release engineer mode
│   ├── browse/SKILL.md               # QA engineer mode (gstack browse)
│   └── reconstruct/SKILL.md          # Geometry reconstruction specialist
├── agents/
│   └── (existing agent configs)
└── CLAUDE.md                          # Updated with skill references

src/lib/
├── llm-balancer.ts                    # Multi-provider load balancer
├── llm-providers.ts                   # Provider adapters (Claude, Gemini, Codex)
└── llm-types.ts                       # Shared types
```

---

## Part 1: LLM Load Balancer

### src/lib/llm-types.ts

```typescript
export type LLMProvider = "claude" | "gemini" | "codex";

export type TaskCategory =
  | "mesh_analysis"      // Analyze mesh stats, recommend repair strategy
  | "code_review"        // Find bugs in geometry pipeline code
  | "code_generation"    // Write new functions, refactor existing
  | "architecture"       // System design, pipeline planning
  | "classification"     // Quick binary decisions, triage
  | "bulk_processing"    // Many small requests (e.g., per-file analysis)
  | "general";           // Default

export interface LLMRequest {
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  maxTokens?: number;
  temperature?: number;
  category: TaskCategory;
  preferredProvider?: LLMProvider;
  /** If true, never fall back to another provider */
  requireProvider?: boolean;
}

export interface LLMResponse {
  text: string;
  provider: LLMProvider;
  model: string;
  tokensUsed: number;
  latencyMs: number;
}

export interface ProviderConfig {
  provider: LLMProvider;
  model: string;
  apiKeyEnvVar: string;
  rpmLimit: number;        // requests per minute
  tpmLimit: number;        // tokens per minute
  maxContextTokens: number;
  costPer1kInput: number;  // USD
  costPer1kOutput: number;
  endpoint: string;
}
```

### src/lib/llm-providers.ts

```typescript
import type { ProviderConfig } from "./llm-types";

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  claude: {
    provider: "claude",
    model: "claude-sonnet-4-20250514",
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    rpmLimit: 50,
    tpmLimit: 80_000,
    maxContextTokens: 200_000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    endpoint: "https://api.anthropic.com/v1/messages",
  },
  gemini: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    apiKeyEnvVar: "GEMINI_API_KEY",
    rpmLimit: 1000,
    tpmLimit: 1_000_000,
    maxContextTokens: 1_000_000,
    costPer1kInput: 0.0001,
    costPer1kOutput: 0.0004,
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
  },
  codex: {
    provider: "codex",
    model: "gpt-4.1",
    apiKeyEnvVar: "OPENAI_API_KEY",
    rpmLimit: 60,
    tpmLimit: 90_000,
    maxContextTokens: 128_000,
    costPer1kInput: 0.002,
    costPer1kOutput: 0.008,
    endpoint: "https://api.openai.com/v1/chat/completions",
  },
};

/** 
 * Task → provider priority order.
 * First provider with headroom gets the request.
 */
export const TASK_ROUTING: Record<string, string[]> = {
  mesh_analysis:    ["claude", "gemini", "codex"],
  code_review:      ["claude", "codex", "gemini"],
  code_generation:  ["codex", "claude", "gemini"],
  architecture:     ["claude", "codex", "gemini"],
  classification:   ["gemini", "claude", "codex"],
  bulk_processing:  ["gemini", "codex", "claude"],
  general:          ["gemini", "claude", "codex"],
};
```

### src/lib/llm-balancer.ts

```typescript
import type { LLMProvider, LLMRequest, LLMResponse, ProviderConfig } from "./llm-types";
import { PROVIDER_CONFIGS, TASK_ROUTING } from "./llm-providers";

/**
 * Sliding window rate tracker.
 * Records timestamps and token counts of recent requests.
 * Reports headroom as a percentage of remaining capacity.
 */
class RateWindow {
  private requests: { time: number; tokens: number }[] = [];
  private windowMs: number;
  
  constructor(
    private rpmLimit: number,
    private tpmLimit: number,
    windowMs = 60_000,
  ) {
    this.windowMs = windowMs;
  }

  private prune() {
    const cutoff = Date.now() - this.windowMs;
    while (this.requests.length > 0 && this.requests[0].time < cutoff) {
      this.requests.shift();
    }
  }

  record(tokens: number) {
    this.requests.push({ time: Date.now(), tokens });
  }

  /** Returns 0.0 (exhausted) to 1.0 (fully available) */
  headroom(): number {
    this.prune();
    const requestsUsed = this.requests.length;
    const tokensUsed = this.requests.reduce((s, r) => s + r.tokens, 0);
    
    const rpmHeadroom = Math.max(0, 1 - requestsUsed / this.rpmLimit);
    const tpmHeadroom = Math.max(0, 1 - tokensUsed / this.tpmLimit);
    
    return Math.min(rpmHeadroom, tpmHeadroom);
  }

  /** Seconds until enough capacity frees up for one more request */
  cooldownSeconds(): number {
    this.prune();
    if (this.requests.length === 0) return 0;
    const oldest = this.requests[0].time;
    const freeAt = oldest + this.windowMs;
    return Math.max(0, Math.ceil((freeAt - Date.now()) / 1000));
  }
}

/**
 * Multi-provider LLM load balancer.
 * 
 * Usage:
 *   const balancer = new LLMBalancer();
 *   const response = await balancer.complete({
 *     messages: [{ role: "user", content: "Analyze this mesh..." }],
 *     category: "mesh_analysis",
 *   });
 */
export class LLMBalancer {
  private windows = new Map<LLMProvider, RateWindow>();
  private configs: Record<string, ProviderConfig>;

  constructor(configs?: Record<string, ProviderConfig>) {
    this.configs = configs ?? PROVIDER_CONFIGS;
    for (const [key, cfg] of Object.entries(this.configs)) {
      this.windows.set(
        cfg.provider,
        new RateWindow(cfg.rpmLimit, cfg.tpmLimit),
      );
    }
  }

  /**
   * Route a request to the best available provider.
   * 
   * 1. Look up priority order for this task category
   * 2. Check headroom on each provider in order
   * 3. Use first provider with > 30% headroom
   * 4. If none available, wait for shortest cooldown and retry
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const priorities = request.preferredProvider
      ? [request.preferredProvider, ...TASK_ROUTING[request.category].filter(p => p !== request.preferredProvider)]
      : TASK_ROUTING[request.category] ?? TASK_ROUTING.general;

    const HEADROOM_THRESHOLD = 0.3;
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Find a provider with headroom
      for (const providerKey of priorities) {
        if (request.requireProvider && providerKey !== request.preferredProvider) continue;
        
        const cfg = this.configs[providerKey];
        if (!cfg) continue;
        
        const apiKey = process.env[cfg.apiKeyEnvVar];
        if (!apiKey) continue; // provider not configured

        const window = this.windows.get(cfg.provider)!;
        const headroom = window.headroom();

        if (headroom < HEADROOM_THRESHOLD && attempt < MAX_RETRIES - 1) continue;

        // This provider has capacity — send the request
        const t0 = Date.now();
        try {
          const result = await this.callProvider(cfg, apiKey, request);
          window.record(result.tokensUsed);
          return {
            ...result,
            provider: cfg.provider,
            model: cfg.model,
            latencyMs: Date.now() - t0,
          };
        } catch (err: any) {
          // Rate limited by the API itself — mark headroom as zero and try next
          if (err?.status === 429) {
            window.record(cfg.tpmLimit); // artificially exhaust the window
            continue;
          }
          throw err;
        }
      }

      // All providers exhausted — find shortest cooldown
      let minCooldown = Infinity;
      for (const [, window] of this.windows) {
        minCooldown = Math.min(minCooldown, window.cooldownSeconds());
      }
      
      if (minCooldown > 0 && attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, minCooldown * 1000));
      }
    }

    throw new Error("All LLM providers exhausted after retries");
  }

  /** Get current headroom across all providers */
  status(): Record<string, { headroom: number; cooldown: number }> {
    const result: Record<string, { headroom: number; cooldown: number }> = {};
    for (const [provider, window] of this.windows) {
      result[provider] = {
        headroom: window.headroom(),
        cooldown: window.cooldownSeconds(),
      };
    }
    return result;
  }

  // ─── Provider-specific API calls ──────────────────────────

  private async callProvider(
    cfg: ProviderConfig,
    apiKey: string,
    request: LLMRequest,
  ): Promise<{ text: string; tokensUsed: number }> {
    switch (cfg.provider) {
      case "claude":   return this.callClaude(cfg, apiKey, request);
      case "gemini":   return this.callGemini(cfg, apiKey, request);
      case "codex":    return this.callCodex(cfg, apiKey, request);
      default:         throw new Error(`Unknown provider: ${cfg.provider}`);
    }
  }

  private async callClaude(
    cfg: ProviderConfig, apiKey: string, req: LLMRequest,
  ): Promise<{ text: string; tokensUsed: number }> {
    const systemMsg = req.messages.find(m => m.role === "system");
    const userMsgs = req.messages.filter(m => m.role !== "system");

    const body: any = {
      model: cfg.model,
      max_tokens: req.maxTokens ?? 4096,
      messages: userMsgs.map(m => ({ role: m.role, content: m.content })),
    };
    if (systemMsg) body.system = systemMsg.content;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err: any = new Error(`Claude ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const text = data.content?.map((c: any) => c.text || "").join("") ?? "";
    const tokensUsed = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
    return { text, tokensUsed };
  }

  private async callGemini(
    cfg: ProviderConfig, apiKey: string, req: LLMRequest,
  ): Promise<{ text: string; tokensUsed: number }> {
    const url = `${cfg.endpoint}/${cfg.model}:generateContent?key=${apiKey}`;
    
    const contents = req.messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const systemMsg = req.messages.find(m => m.role === "system");
    const body: any = { contents };
    if (systemMsg) {
      body.system_instruction = { parts: [{ text: systemMsg.content }] };
    }
    if (req.temperature !== undefined) {
      body.generationConfig = { temperature: req.temperature, maxOutputTokens: req.maxTokens ?? 4096 };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err: any = new Error(`Gemini ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") ?? "";
    const tokensUsed = (data.usageMetadata?.promptTokenCount ?? 0) +
                       (data.usageMetadata?.candidatesTokenCount ?? 0);
    return { text, tokensUsed };
  }

  private async callCodex(
    cfg: ProviderConfig, apiKey: string, req: LLMRequest,
  ): Promise<{ text: string; tokensUsed: number }> {
    const body: any = {
      model: cfg.model,
      messages: req.messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: req.maxTokens ?? 4096,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;

    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err: any = new Error(`Codex ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const tokensUsed = (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
    return { text, tokensUsed };
  }
}
```

---

## Part 2: Skill Definitions

Each skill is a SKILL.md file that Claude Code reads as its system prompt when the slash command is invoked. Adapted from gstack's pattern but customized for Karasawa Labs.

### .claude/skills/plan-ceo-review/SKILL.md

```markdown
# /plan-ceo-review — Founder Mode

You are in founder/CEO mode for Karasawa Labs, a precision 3D printing 
and automotive manufacturing platform.

Do NOT take the request literally. Ask a more important question first:
What is this product actually for?

Find the 10-star version hiding inside the request. Think like Brian Chesky.

For Karaslice features specifically, consider:
- What does a professional 3D printing shop actually need?
- What would make this tool replace Netfabb/Magics/Meshmixer?
- What would make users pay $50/month instead of using free alternatives?
- Is this a feature or a workflow? Workflows win.

Output format:
1. Restate the request as the user sees it
2. Explain what the REAL product need is
3. Describe the 10-star version (the magical experience)
4. List 5-8 specific capabilities that make it 10-star
5. Identify the MVP subset that still feels delightful
6. Flag risks and open questions

Use the LLM load balancer for any sub-queries:
- Architecture questions → claude (category: architecture)
- Market/competitive research → gemini (category: classification)
- Code feasibility checks → codex (category: code_generation)
```

### .claude/skills/plan-eng-review/SKILL.md

```markdown
# /plan-eng-review — Engineering Manager Mode

You are a senior engineering manager reviewing the technical plan for 
Karasawa Labs. The product direction is already decided. Your job is to 
make it buildable.

For every feature, produce:
1. Architecture diagram (Mermaid syntax)
2. Data flow diagram showing every boundary crossing
3. State machine for any multi-step process
4. Failure modes and recovery strategy
5. Edge cases with specific test scenarios
6. Performance analysis (memory, time complexity, network)
7. File-by-file implementation plan with estimated LOC

Karasawa Labs specifics:
- Client: Next.js 15, React 19, Three.js, Web Workers, manifold-3d WASM
- Server: Next.js server actions, Firebase (Firestore + Storage)
- Cloud: Cloud Run Python worker (PyMeshLab, Open3D, trimesh)
- AI: Gemini 2.5 Flash (primary), Claude (fallback), via LLM balancer
- Payments: Stripe Checkout
- Shipping: Shippo REST API

Route sub-queries through the balancer:
- Complex architecture → claude (category: architecture)
- Implementation details → codex (category: code_generation)
- Quick lookups → gemini (category: classification)
```

### .claude/skills/review/SKILL.md

```markdown
# /review — Paranoid Staff Engineer Mode

You are a paranoid staff engineer reviewing code for Karasawa Labs.
Your job is to find the bugs that pass CI but blow up in production.

This is NOT a style guide pass. You are looking for:
- NaN propagation in geometry computations (Float32/Float64 boundaries)
- Race conditions between Web Worker postMessage and UI state
- Memory leaks in Three.js (undisposed geometries, materials, textures)
- Manifold invariant violations (see docs/mesh_repair_spec.md)
- Security: file upload validation, Stripe webhook verification, 
  server action authentication
- Epsilon welding where exact dedup is required
- Array.shift() in hot loops (O(n²))
- Dense array allocations exceeding browser memory
- BigInt in hot paths
- Missing error handling on WASM module loading (manifold-3d)
- Firestore security rules gaps

For geometry code specifically, check every function against these invariants:
1. Float64 for geometry, Float32 only at render boundary
2. Indexed rendering with sharp-edge normal splitting
3. No epsilon vertex welding (exact bitwise match only)
4. Intersection vertices cached per edge (min,max key)
5. Cap faces reuse existing vertex indices
6. Sub-triangle winding matches original face normal
7. Grid dimensions capped at 200M cells
8. Normal consistency via BFS before SDF evaluation

Route sub-queries through the balancer:
- Deep code analysis → claude (category: code_review)
- Quick checks → gemini (category: classification)
```

### .claude/skills/reconstruct/SKILL.md

```markdown
# /reconstruct — Geometry Reconstruction Specialist

You are a geometry reconstruction specialist for Karaslice.
Your job is to continuously improve the mesh repair, reconstruction, 
and slicing pipeline until it handles every input mesh correctly.

You have access to these source files:
- src/components/karaslice/manifold-engine.ts
- src/components/karaslice/voxel-reconstruct.ts
- src/components/karaslice/poisson-reconstruct.ts
- src/components/karaslice/mesh-sanitize.ts
- src/components/karaslice/validate-reconstruction.ts
- src/components/karaslice/defect-overlays.ts
- src/components/karaslice/stl-utils.ts
- cloud-worker/repair_pipeline.py
- cloud-worker/boolean_split.py

Run this cycle:
1. AUDIT — Read each file, check against the 8 core invariants
2. TEST — Run `npx vitest run` and `node --test tests/` 
3. FIX — Minimal targeted changes, re-validate after each
4. OPTIMIZE — Profile, reduce allocations, eliminate hot-path objects

Completion criteria (all must be true):
- Every test passes all 8 validation checks
- Import + repair + render < 5 seconds for 1M triangles
- Peak heap < 200MB for 1M triangles
- Slicing produces manifold halves with zero cut-plane boundary edges
- MLS reconstruction preserves openings > 4× resolution
- No BigInt, no Array.shift() in hot paths, no dense arrays > 50M elements

Route sub-queries through the balancer:
- Algorithm research → claude (category: mesh_analysis)
- Code generation → codex (category: code_generation)
- Quick math verification → gemini (category: classification)
```

### .claude/skills/ship/SKILL.md

```markdown
# /ship — Release Engineer Mode

You are a release engineer for Karasawa Labs. The code is ready.
Your job is to land the branch. No more discussion. Execute.

Steps:
1. git fetch origin && git rebase origin/main
2. npm run build (catch type errors)
3. npx vitest run (catch test failures)
4. node --test tests/ (catch geometry test failures)
5. If all pass: git push origin HEAD
6. Open or update the PR with a clear summary

If build or tests fail:
- Fix the issue directly (do not ask the user)
- Re-run the failing step
- If you cannot fix it in 2 attempts, report the specific failure

Do NOT:
- Refactor unrelated code
- Add new features
- Change the PR description beyond factual accuracy
- Squash commits (let the user decide)

Use the LLM balancer for any error diagnosis:
- Build errors → codex (category: code_generation)
- Test failures → claude (category: code_review)
```

### .claude/skills/browse/SKILL.md

```markdown
# /browse — QA Engineer Mode

Use gstack's browse binary for visual QA. If the binary is not built,
run: cd .claude/skills/gstack && ./setup

For Karasawa Labs, the standard QA checklist:

1. Load the target URL
2. Check console for errors
3. Screenshot every page changed in this branch
4. For Karaslice: upload a test STL, verify viewport renders,
   run repair, verify defect overlays, check mesh analysis panel
5. For checkout: verify Stripe redirect and success page
6. For auth: test OAuth flow (Google at minimum)
7. Report all findings with screenshots

Target URLs:
- Local: http://localhost:9002
- Staging: (set STAGING_URL in env)
- Production: https://karasawalabs.com
```

---

## Part 3: CLAUDE.md Updates

Add this section to the project's `CLAUDE.md` (or `README.md` if no `CLAUDE.md` exists):

```markdown
## Agent Skills

Karasawa Labs uses gstack-style specialist agents with multi-LLM 
load balancing across Claude, Gemini, and Codex/OpenAI.

### Available Skills
- `/plan-ceo-review` — Founder mode. Rethink the problem.
- `/plan-eng-review` — Eng manager mode. Lock in architecture.
- `/review` — Paranoid staff engineer. Find production bugs.
- `/reconstruct` — Geometry specialist. Improve the repair pipeline.
- `/ship` — Release engineer. Land the branch.
- `/browse` — QA engineer. Visual testing via headless Chromium.

### LLM Load Balancer
All AI calls route through `src/lib/llm-balancer.ts` which distributes
across providers based on real-time rate limit headroom:

| Provider | Best For | RPM | TPM |
|----------|----------|-----|-----|
| Claude | Code review, architecture, mesh analysis | 50 | 80K |
| Gemini | Fast classification, bulk processing | 1000 | 1M |
| Codex | Code generation, refactoring | 60 | 90K |

Rate limits are tracked per-provider with a 60-second sliding window.
Requests automatically fall to the next provider when headroom drops 
below 30%.

### Required API Keys
```
ANTHROPIC_API_KEY=       # Claude
GEMINI_API_KEY=          # Gemini (already exists)
OPENAI_API_KEY=          # Codex/OpenAI
```

### Using the Balancer in Code
```typescript
import { LLMBalancer } from "@/lib/llm-balancer";

const llm = new LLMBalancer();
const response = await llm.complete({
  messages: [
    { role: "system", content: "You are a mesh analysis expert." },
    { role: "user", content: "Classify this mesh..." },
  ],
  category: "mesh_analysis",  // routes to Claude first
});
```
```

---

## Part 4: Integration with Existing Codebase

### Replace Direct AI Calls

The existing codebase makes direct Gemini calls via Genkit in:
- `src/ai/flows/quote-generator-flow.ts`
- `src/ai/flows/ai-engineering-assistant-flow.ts`
- `src/app/actions/mesh-analysis-actions.ts`

These should be updated to route through the balancer:

```typescript
// BEFORE (direct Genkit call)
import { generate } from "@genkit-ai/ai";
const result = await generate({ model: gemini31Pro, prompt: "..." });

// AFTER (load-balanced)
import { LLMBalancer } from "@/lib/llm-balancer";
const llm = new LLMBalancer();
const result = await llm.complete({
  messages: [{ role: "user", content: "..." }],
  category: "mesh_analysis",
});
```

Keep the existing Genkit flows for backward compatibility but add the 
balancer as an alternative path. Genkit flows can remain the primary 
for quote generation (Gemini-specific features like grounding), while 
the balancer handles mesh analysis and code review where provider 
flexibility matters.

### CI/CD Integration

The existing `.github/workflows/reconstruct-autofix.yml` already uses 
Claude for auto-fixing. Update it to use the balancer for diagnosis:

```yaml
- name: Diagnose failure
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  run: |
    # The diagnose script uses LLMBalancer internally
    # Falls back across providers if one is rate-limited
    npx tsx scripts/diagnose-failure.ts "$FAILURE_LOG"
```

---

## Part 5: Environment Variables

Add to `apphosting.yaml` and `.env`:

```yaml
# Existing
GEMINI_API_KEY: your-gemini-key
ANTHROPIC_API_KEY: your-anthropic-key

# New
OPENAI_API_KEY: your-openai-key
```

---

## Implementation Order

1. **Create `src/lib/llm-types.ts`, `llm-providers.ts`, `llm-balancer.ts`** — the core balancer. Test with a simple script that sends 10 requests and verifies they distribute across providers.

2. **Create skill SKILL.md files** in `.claude/skills/`. These are just markdown files — no code changes required for Claude Code to pick them up.

3. **Update `CLAUDE.md`** with the skills reference section.

4. **Wire `mesh-analysis-actions.ts`** to use the balancer for AI mesh analysis (currently direct Genkit/Gemini). This is the highest-value integration point because mesh analysis is the most frequent AI call and the most likely to hit rate limits during batch testing.

5. **Update the CI workflow** to pass all three API keys and use the balancer for failure diagnosis.

6. **Install gstack browse** for visual QA: `git clone https://github.com/garrytan/gstack.git .claude/skills/gstack && cd .claude/skills/gstack && ./setup`

7. **Test the full loop**: `/plan-ceo-review` a new feature → `/plan-eng-review` the architecture → implement → `/review` the code → `/ship` the branch → `/browse` staging to verify.
```
