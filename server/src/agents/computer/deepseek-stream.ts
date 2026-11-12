import type { EngineHopReport, EngineUsage } from './engine.js'

/** dsh headless stdout, verified against the official headless JSON projector.
 * A clean process exit alone does not establish a completed turn. */
export class DeepSeekTurnTracker {
  sessionId: string | null = null
  text = ''
  error: string | undefined
  usage: EngineUsage | undefined
  completed = false
  private hop = 0
  private incomplete = false
  private cacheReadKnown = true
  private cacheWriteKnown = true

  constructor(private readonly model: string | null, private readonly onHopUsage?: (report: EngineHopReport) => void) {}

  observe(line: string): void {
    let value: unknown
    try { value = JSON.parse(line) } catch { return }
    if (!record(value)) return
    if (typeof value.sessionId === 'string') this.sessionId = value.sessionId
    if (value.type === 'error') {
      this.error = typeof value.message === 'string' ? value.message.slice(0, 4000) : 'DeepSeek Harness failed'
    }
    if (value.type === 'final') {
      this.completed = record(value.reason) && value.reason.kind === 'completed'
      if (typeof value.text === 'string') this.text = value.text
      if (!this.completed) this.error ??= `DeepSeek Harness did not complete: ${JSON.stringify(value.reason)?.slice(0, 4000)}`
    }
    if (value.type !== 'status' || value.phase !== 'step_end') return
    this.hop += 1
    if (!record(value.usage) || !token(value.usage.inputTokens) || !token(value.usage.outputTokens)) {
      this.incomplete = true
      this.usage = undefined
      return
    }
    const raw = value.usage
    const usage: EngineUsage = { input_tokens: value.usage.inputTokens, output_tokens: value.usage.outputTokens }
    // Keep optional buckets absent when the provider did not report them.
    if (token(raw.cacheReadTokens)) usage.cache_read_input_tokens = raw.cacheReadTokens
    if (token(raw.cacheWriteTokens)) usage.cache_creation_input_tokens = raw.cacheWriteTokens
    this.cacheReadKnown &&= token(raw.cacheReadTokens)
    this.cacheWriteKnown &&= token(raw.cacheWriteTokens)
    if (!this.incomplete) this.usage = {
      input_tokens: (this.usage?.input_tokens ?? 0) + usage.input_tokens!,
      output_tokens: (this.usage?.output_tokens ?? 0) + usage.output_tokens!,
      ...(!this.cacheReadKnown ? {} : {
        cache_read_input_tokens: (this.usage?.cache_read_input_tokens ?? 0) + usage.cache_read_input_tokens!,
      }),
      ...(!this.cacheWriteKnown ? {} : {
        cache_creation_input_tokens: (this.usage?.cache_creation_input_tokens ?? 0) + usage.cache_creation_input_tokens!,
      }),
    }
    try { this.onHopUsage?.({ model: this.model ?? 'deepseek', usage, hopIndex: this.hop }) }
    catch { /* Ledger failures must not alter the engine's task result. */ }
  }

  failure(): string | undefined {
    return this.error ?? (!this.completed
      ? 'DeepSeek Harness exited without a completed final event'
      : this.sessionId ? undefined : 'DeepSeek Harness completed without a session identity')
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function token(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
