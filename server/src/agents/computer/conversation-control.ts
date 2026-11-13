export interface ConversationControl {
  conversationId: string
  paused: boolean
  revision: number
}

/** One chat turn can contain several rooms. A changed control generation
 * cancels that turn even if a quick pause/resume happened between polls. */
export class ConversationTurnControl {
  private rows: ConversationControl[] = []
  private active: { controller: AbortController; ids: Set<string>; revisions: Map<string, number> } | null = null

  begin(): AbortSignal {
    if (this.active) throw new Error('chat turn already active')
    this.active = { controller: new AbortController(), ids: new Set(), revisions: new Map(this.rows.map((r) => [r.conversationId, r.revision])) }
    return this.active.controller.signal
  }

  scope(ids: Iterable<string>): void {
    if (!this.active) throw new Error('no active chat turn')
    this.active.ids = new Set(ids)
    this.apply(this.rows)
  }

  include(conversationId: string): boolean {
    if (!this.active || this.active.controller.signal.aborted) return false
    const row = this.rows.find((r) => r.conversationId === conversationId)
    // A late probe may carry input from before this room was paused/resumed.
    // Reject the injection without extending or cancelling the current turn.
    if (row && (row.paused || row.revision !== (this.active.revisions.get(conversationId) ?? 0))) return false
    this.active.ids.add(conversationId)
    return true
  }

  apply(rows: ConversationControl[]): boolean {
    this.rows = rows
    const active = this.active
    if (!active || active.controller.signal.aborted) return false
    if (rows.some((r) => active.ids.has(r.conversationId)
      && (r.paused || r.revision !== (active.revisions.get(r.conversationId) ?? 0)))) {
      active.controller.abort(new Error('conversation paused or control generation changed'))
      return true
    }
    return false
  }

  finish(): void { this.active = null }
  revisionFor(conversationId: string): number { return this.rows.find((r) => r.conversationId === conversationId)?.revision ?? 0 }
  get cancelled(): boolean { return this.active?.controller.signal.aborted ?? false }
  get revisions(): Record<string, number> | undefined {
    return this.active ? Object.fromEntries([...this.active.revisions, ...[...this.active.ids].map((id) => [id, this.active!.revisions.get(id) ?? 0] as const)]) : undefined
  }
  get paused(): ReadonlySet<string> { return new Set(this.rows.filter((r) => r.paused).map((r) => r.conversationId)) }
  get stopped(): ConversationControl[] {
    return this.rows.filter((r) => r.paused && !this.active?.ids.has(r.conversationId))
  }
}
