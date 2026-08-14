import { useState } from 'react'
import { motion } from 'motion/react'
import { PROVIDER_INFO } from '@shared/types'
import { useCurriculum } from '../../store/useCurriculum'
import { cn } from '../../lib/cn'
import { SPRING } from '../../lib/motion'

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; models: number }
  | { kind: 'failed'; message: string }

export function KeyVault({ onDone }: { onDone?: () => void }) {
  const keyStatus = useCurriculum((s) => s.keyStatus)
  const saveKey = useCurriculum((s) => s.saveKey)
  const clearKey = useCurriculum((s) => s.clearKey)
  const testKey = useCurriculum((s) => s.testKey)
  const provider = useCurriculum((s) => s.goalsProvider)

  const [value, setValue] = useState('')
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)

  const { label, keyHint } = PROVIDER_INFO[provider]
  const unavailable = keyStatus?.encryptionAvailable === false

  async function runTest() {
    setTest({ kind: 'testing' })
    try {
      const models = await testKey(value.trim() || undefined)
      setTest({ kind: 'ok', models })
    } catch (err) {
      setTest({
        kind: 'failed',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async function save() {
    if (!value.trim()) return
    setSaving(true)
    try {
      await saveKey(value.trim())
      setValue('')
      setTest({ kind: 'idle' })
      onDone?.()
    } catch (err) {
      setTest({
        kind: 'failed',
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-line-soft bg-surface/70 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[14px] tracking-[-0.01em]">{label} API key</h2>
          <p className="mt-1 max-w-md text-[12px] leading-relaxed text-ink-faint">
            Encrypted with the macOS keychain and read only by the app&rsquo;s
            background process. There is no way to read it back out — not even
            from this screen. To use a different provider — OpenAI, Grok,
            Claude, or your own server — change it in Settings; a key from one
            vendor is always rejected by another.
          </p>
        </div>

        {keyStatus?.present && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-cat-learn/30 bg-cat-learn/10 px-2 py-0.5 text-[11px] text-cat-learn">
            <span className="size-1.5 rounded-full bg-cat-learn" />
            saved
          </span>
        )}
      </div>

      {unavailable && (
        <p className="mt-3 rounded-lg border border-amber/30 bg-amber/8 px-3 py-2 text-[12px] text-amber-soft">
          The OS keychain is unavailable on this machine, so Day Deck will not
          store a key. Plan generation stays disabled — everything else works.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setTest({ kind: 'idle' })
          }}
          disabled={unavailable}
          placeholder={
            keyStatus?.present
              ? 'Replace the saved key…'
              : keyHint
                ? `Paste your ${label} key (${keyHint})`
                : `Paste your ${label} key`
          }
          autoComplete="off"
          spellCheck={false}
          aria-label={`${label} API key`}
          className={cn(
            'min-w-[240px] flex-1 rounded-lg border border-line-soft bg-canvas px-3 py-2',
            'font-mono text-[12.5px] outline-none transition-colors',
            'placeholder:font-sans placeholder:text-ink-faint/60 focus:border-line',
            'disabled:opacity-50'
          )}
        />

        <motion.button
          type="button"
          onClick={() => void runTest()}
          whileTap={{ scale: 0.96 }}
          disabled={
            unavailable ||
            test.kind === 'testing' ||
            (!value.trim() && !keyStatus?.present)
          }
          className="rounded-lg border border-line-soft px-3 py-2 text-[12px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-40"
        >
          {test.kind === 'testing' ? 'Testing…' : 'Test'}
        </motion.button>

        <motion.button
          type="button"
          onClick={() => void save()}
          whileTap={{ scale: 0.96 }}
          disabled={unavailable || !value.trim() || saving}
          className={cn(
            'rounded-lg px-3 py-2 text-[12px] transition-colors',
            value.trim() && !unavailable
              ? 'bg-amber/15 text-amber-soft hover:bg-amber/25'
              : 'text-ink-faint/50'
          )}
        >
          {saving ? 'Saving…' : 'Save'}
        </motion.button>

        {keyStatus?.present && (
          <button
            type="button"
            onClick={() => void clearKey()}
            className="rounded-lg px-2 py-2 text-[12px] text-ink-faint transition-colors hover:text-ink"
          >
            Remove
          </button>
        )}
      </div>

      {test.kind !== 'idle' && test.kind !== 'testing' && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING.snap}
          className={cn(
            'mt-3 text-[12px]',
            test.kind === 'ok' ? 'text-cat-learn' : 'text-amber-soft'
          )}
        >
          {test.kind === 'ok'
            ? `Connected — ${test.models} models available on ${label}.`
            : test.message}
        </motion.p>
      )}
    </div>
  )
}
