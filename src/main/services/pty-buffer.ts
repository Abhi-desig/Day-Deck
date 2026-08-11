/**
 * Coalesces pty output before it crosses the IPC boundary.
 *
 * A pty emits whatever the program wrote, which for something like a test
 * runner is hundreds of tiny writes a second. Forwarding each one as its own
 * IPC message costs a structured-clone round trip per write and starves the
 * renderer; xterm is perfectly happy to receive the same bytes in one string.
 *
 * The size cap matters as much as the timer: a `cat` of a large file must not
 * accumulate megabytes in main waiting for a tick that is only 8ms away.
 */
export interface ChunkBufferOptions {
  /** Flush once this much text is pending, without waiting for the timer. */
  maxChars?: number
  /** How long a small write waits for company. */
  delayMs?: number
  onFlush(data: string): void
}

export class ChunkBuffer {
  private pending: string[] = []
  private length = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly maxChars: number
  private readonly delayMs: number
  private readonly onFlush: (data: string) => void

  constructor(options: ChunkBufferOptions) {
    this.maxChars = options.maxChars ?? 16_384
    this.delayMs = options.delayMs ?? 8
    this.onFlush = options.onFlush
  }

  push(data: string): void {
    if (!data) return
    this.pending.push(data)
    this.length += data.length

    if (this.length >= this.maxChars) {
      this.flush()
      return
    }
    // Already waiting — the existing timer covers this write too, so the delay
    // is a ceiling on latency rather than a per-write cost.
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.delayMs)
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.length === 0) return

    const data = this.pending.join('')
    this.pending = []
    this.length = 0
    this.onFlush(data)
  }

  /** Flush whatever is left, then stop. Used when the pty exits or is killed. */
  dispose(): void {
    this.flush()
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
