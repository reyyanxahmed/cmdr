export interface StreamEvent {
  type: 'text' | 'tool_start' | 'tool_done' | 'tool_error' | 'done' | 'error'
  text?: string
  tool?: string
  input?: unknown
  output?: string
  duration?: number
  error?: string
  tokens?: { input: number; output: number }
}

export class StreamClient {
  private controller: AbortController | null = null

  async stream(
    baseUrl: string,
    prompt: string,
    options: { model?: string; effort?: string; images?: string[] },
    onEvent: (event: StreamEvent) => void,
  ): Promise<void> {
    this.controller = new AbortController()

    const response = await fetch(`${baseUrl}/v1/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt, ...options }),
      signal: this.controller.signal,
    })

    if (!response.ok) {
      onEvent({ type: 'error', error: `Server error: ${response.status} ${response.statusText}` })
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      onEvent({ type: 'error', error: 'No response body' })
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') {
            onEvent({ type: 'done' })
            return
          }
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'text' || parsed.content) {
              onEvent({ type: 'text', text: parsed.content || parsed.text || '' })
            } else if (parsed.type === 'tool_start') {
              onEvent({ type: 'tool_start', tool: parsed.tool, input: parsed.input })
            } else if (parsed.type === 'tool_done') {
              onEvent({
                type: 'tool_done',
                tool: parsed.tool,
                output: parsed.output,
                duration: parsed.duration,
              })
            } else if (parsed.type === 'tool_error') {
              onEvent({ type: 'tool_error', tool: parsed.tool, error: parsed.error })
            } else if (parsed.type === 'error') {
              onEvent({ type: 'error', error: parsed.error || parsed.message })
            } else if (parsed.type === 'done') {
              onEvent({ type: 'done', tokens: parsed.tokens })
            } else if (typeof parsed.response === 'string') {
              // Ollama-style response
              onEvent({ type: 'text', text: parsed.response })
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
      onEvent({ type: 'done' })
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      onEvent({ type: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  stop(): void {
    this.controller?.abort()
    this.controller = null
  }
}
