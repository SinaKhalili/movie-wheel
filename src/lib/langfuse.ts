/**
 * Minimal Langfuse tracing for the Cloudflare Workers / edge runtime.
 *
 * Langfuse's v5 JS SDK is OpenTelemetry-based and its span processor targets
 * Node ≥ 20 — APIs Workers don't have. On Workers its background flush can
 * resolve without persisting, silently dropping traces (langfuse/langfuse
 * #11984, #6633). The reliable edge path is to POST events straight to the
 * batch-ingestion API. We `await` that flush (the surrounding LLM + TMDB work
 * already takes seconds, so a ~100 ms telemetry POST is negligible) behind a
 * short timeout, and never let it throw into the request — telemetry must not
 * break the feature.
 *
 * Ingestion: POST {base}/api/public/ingestion  { batch: [{ id, type, timestamp, body }] }
 * Auth: Basic base64(publicKey:secretKey).   Docs: langfuse.com/docs/observability
 */

/** .dev.vars sometimes wraps values in quotes — strip them defensively. */
function envVar(name: string): string | undefined {
  const v = process.env[name]
  return v ? v.replace(/^["']|["']$/g, '') : v
}

export function langfuseEnabled(): boolean {
  return !!(envVar('LANGFUSE_PUBLIC_KEY') && envVar('LANGFUSE_SECRET_KEY'))
}

export type Usage = Record<string, number>
type Level = 'DEFAULT' | 'WARNING' | 'ERROR'

export type Generation = {
  name: string
  model: string
  input: unknown
  output: unknown
  startTime: string
  endTime: string
  usage?: Usage
  metadata?: Record<string, unknown>
  level?: Level
  statusMessage?: string
}

export type Span = {
  name: string
  input?: unknown
  output?: unknown
  startTime: string
  endTime: string
  metadata?: Record<string, unknown>
}

export type Trace = {
  /** Descriptive, filterable name, e.g. "ai-pick-films". */
  name: string
  input: unknown
  output: unknown
  startTime: string
  endTime: string
  /** Groups related calls (e.g. blurb + pick of one prompt) in the Sessions view. */
  sessionId?: string
  userId?: string
  tags?: string[]
  metadata?: Record<string, unknown>
  generations?: Generation[]
  spans?: Span[]
  level?: Level
  statusMessage?: string
}

/** Normalize an OpenAI chat-completions `usage` object to Langfuse usageDetails. */
export function openaiUsage(raw: unknown): Usage | undefined {
  const u = raw as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } }
    | undefined
  if (!u) return undefined
  const usage: Usage = {}
  if (u.prompt_tokens != null) usage.input = u.prompt_tokens
  if (u.completion_tokens != null) usage.output = u.completion_tokens
  if (u.total_tokens != null) usage.total = u.total_tokens
  const reasoning = u.completion_tokens_details?.reasoning_tokens
  if (reasoning) usage.reasoning = reasoning
  return Object.keys(usage).length ? usage : undefined
}

type IngestionEvent = { id: string; type: string; timestamp: string; body: Record<string, unknown> }

async function ingest(batch: IngestionEvent[]): Promise<void> {
  const base = (envVar('LANGFUSE_BASE_URL') || 'https://cloud.langfuse.com').replace(/\/+$/, '')
  const auth = btoa(`${envVar('LANGFUSE_PUBLIC_KEY')}:${envVar('LANGFUSE_SECRET_KEY')}`)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 2500)
  try {
    await fetch(`${base}/api/public/ingestion`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify({ batch }),
      signal: ctrl.signal,
    })
  } catch {
    // telemetry must never break the request
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Record one trace with nested generations + spans, then flush. Awaited, but
 * bounded and non-throwing — safe to `await` right before returning a result.
 */
export async function logTrace(t: Trace): Promise<void> {
  if (!langfuseEnabled()) return
  const traceId = crypto.randomUUID()
  const meta = t.metadata
  const batch: IngestionEvent[] = [
    {
      id: crypto.randomUUID(),
      type: 'trace-create',
      timestamp: t.startTime,
      body: {
        id: traceId,
        name: t.name,
        timestamp: t.startTime,
        sessionId: t.sessionId || undefined,
        userId: t.userId || undefined,
        input: t.input,
        output: t.output,
        tags: t.tags,
        metadata: meta,
      },
    },
  ]
  for (const g of t.generations ?? []) {
    batch.push({
      id: crypto.randomUUID(),
      type: 'generation-create',
      timestamp: g.startTime,
      body: {
        id: crypto.randomUUID(),
        traceId,
        name: g.name,
        startTime: g.startTime,
        endTime: g.endTime,
        model: g.model,
        input: g.input,
        output: g.output,
        usageDetails: g.usage,
        metadata: g.metadata,
        level: g.level,
        statusMessage: g.statusMessage,
      },
    })
  }
  for (const s of t.spans ?? []) {
    batch.push({
      id: crypto.randomUUID(),
      type: 'span-create',
      timestamp: s.startTime,
      body: {
        id: crypto.randomUUID(),
        traceId,
        name: s.name,
        startTime: s.startTime,
        endTime: s.endTime,
        input: s.input,
        output: s.output,
        metadata: s.metadata,
      },
    })
  }
  await ingest(batch)
}
