# AI Provider Reference

Quick reference for all AI providers used in this project, their Genkit integration patterns, available models, and API usage.

---

## Genkit Plugin Setup

### Anthropic (via genkitx-anthropic)

```typescript
import { genkit } from 'genkit';
import { anthropic, claude4Sonnet } from 'genkitx-anthropic';

const ai = genkit({ plugins: [anthropic()] });

const { text } = await ai.generate({
    model: claude4Sonnet,
    prompt: 'Why is Genkit awesome?'
});
```

**Available model exports (v0.30.0):**

| Export | Model |
|--------|-------|
| `claude45Opus` | Claude 4.5 Opus |
| `claude45Sonnet` | Claude 4.5 Sonnet |
| `claude45Haiku` | Claude 4.5 Haiku |
| `claude4Opus` | Claude 4 Opus |
| `claude4Sonnet` | Claude 4 Sonnet |
| `claude37Sonnet` | Claude 3.7 Sonnet |
| `claude35Sonnet` | Claude 3.5 Sonnet |
| `claude35Haiku` | Claude 3.5 Haiku |
| `claude3Opus` | Claude 3 Opus |
| `claude3Sonnet` | Claude 3 Sonnet |
| `claude3Haiku` | Claude 3 Haiku |

**Env var:** `ANTHROPIC_API_KEY`

### OpenAI (via @genkit-ai/compat-oai)

```typescript
import { genkit } from 'genkit';
import openAI from '@genkit-ai/compat-oai';

const ai = genkit({ plugins: [openAI({ name: 'openai', apiKey: process.env.OPENAI_API_KEY })] });

const { text } = await ai.generate({
    model: 'openai/gpt-5-nano-2025-08-07',
    prompt: 'Why is Genkit awesome?'
});
```

**Common models:**

| Model ID | Notes |
|----------|-------|
| `openai/gpt-5` | Flagship |
| `openai/gpt-5-mini-2025-08-07` | Balanced performance/cost |
| `openai/gpt-5-nano-2025-08-07` | Fast, cost-effective |
| `openai/gpt-4o` | Previous gen flagship |

**Env var:** `OPENAI_API_KEY`

### Google AI (via @genkit-ai/google-genai)

```typescript
import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

const ai = genkit({ plugins: [googleAI()] });

const { text } = await ai.generate({
    model: 'googleai/gemini-3-flash-preview',
    prompt: 'Why is Genkit awesome?'
});
```

**Env var:** `GOOGLE_GENAI_API_KEY`

---

## Google Gemini Models

> **Warning:** Gemini 3 Pro Preview is deprecated and was shut down March 9, 2026. Use Gemini 3.1 Pro Preview instead.

### Gemini 3 Family

| Model | ID | Notes |
|-------|---------|-------|
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` | Advanced reasoning, agentic capabilities |
| Gemini 3 Flash | `gemini-3-flash-preview` | Frontier performance at low cost |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite-preview` | Budget-friendly, high efficiency |

### Gemini 2.5 Family

| Model | ID | Notes |
|-------|---------|-------|
| Gemini 2.5 Pro | `gemini-2.5-pro` | Most advanced reasoning and coding |
| Gemini 2.5 Flash | `gemini-2.5-flash` | Best price-performance for reasoning |
| Gemini 2.5 Flash-Lite | `gemini-2.5-flash-lite` | Fastest, most budget-friendly |

### Model Version Patterns

- **Stable**: `gemini-2.5-flash` — production use, rarely changes
- **Preview**: `gemini-2.5-flash-preview-09-2025` — production-ready with billing, 2-week deprecation notice
- **Latest**: `gemini-flash-latest` — hot-swapped on new releases, 2-week notice before change
- **Experimental**: Unstable, restrictive rate limits, for feedback/testing

---

## Direct API Usage (Non-Genkit)

### Anthropic SDK

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env['ANTHROPIC_API_KEY'],
});

// List available models
for await (const modelInfo of client.models.list()) {
  console.log(modelInfo.id);
}
```

### OpenAI SDK

```typescript
import OpenAI from "openai";
const client = new OpenAI();

const response = await client.responses.create({
    model: "gpt-5",
    input: "Write a one-sentence bedtime story about a unicorn."
});

console.log(response.output_text);
```

---

## Current Project Configuration

See `src/ai/models.ts` for centralized model selection:

| Role | Model | Rationale |
|------|-------|-----------|
| DRAFTING_MODEL | `openai/gpt-5-nano-2025-08-07` | Fast, cost-effective for initial generation |
| REFINING_MODEL | `claude4Sonnet` | Quality second-pass refinement |
| FORGESCORE_MODEL | `openai/gpt-5-nano-2025-08-07` | Resume-job matching analysis |
| PARSER_MODEL | `googleai/gemini-3-flash-preview` | Resume text parsing to structured JSON |

Plugin initialization: `src/ai/ai-instance.ts`
