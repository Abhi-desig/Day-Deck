import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  KEY_SLOTS,
  KEY_SLOT_LABEL,
  PROJECT_KINDS,
  type KeySlot,
  type KeyStatus,
  type ProjectHomes,
  type ProjectKind
} from '@shared/types'
import { cn } from '../../lib/cn'
import { api } from '../../lib/api'
import { useProjects } from '../../store/useProjects'

/**
 * Settings: the API keys, the rate limit, and where projects live.
 *
 * Deliberately thin — every row talks straight to the validated IPC surface
 * and re-reads what it changed. The one invariant worth restating here is the
 * vault's: keys go over the bridge exactly once, on save, and there is no call
 * that brings one back.
 */
export function Settings() {
  const [statuses, setStatuses] = useState<Partial<Record<KeySlot, KeyStatus>>>(
    {}
  )
  const [rate, setRate] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const homes = useProjects((s) => s.homes)
  const loadHomes = useProjects((s) => s.loadHomes)
  const pickHome = useProjects((s) => s.pickHome)

  async function loadStatuses(): Promise<void> {
    try {
      const entries = await Promise.all(
        KEY_SLOTS.map(
          async (slot) => [slot, await api.settings.keyStatus(slot)] as const
        )
      )
      setStatuses(Object.fromEntries(entries))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void loadStatuses()
    void loadHomes()
    api.settings
      .rate()
      .then(setRate)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [loadHomes])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 pb-7">
      <header className="flex shrink-0 items-baseline gap-3 pb-4">
        <h1 className="text-[19px] font-medium tracking-[-0.02em]">Settings</h1>
        <span className="text-[12.5px] text-ink-faint">
          Keys, rate limits, and where things live
        </span>
      </header>

      {error && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber/30 bg-amber/8 px-3.5 py-2">
          <span className="flex-1 text-[12.5px] text-amber-soft">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-[11px] text-amber-soft/70 hover:text-amber-soft"
          >
            Dismiss
          </button>
        </div>
      )}

      <section className="mb-4 rounded-xl border border-line-soft bg-surface/70 p-5">
        <h2 className="text-[14px] tracking-[-0.01em]">API keys</h2>
        <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-ink-faint">
          All Gemini, one slot per feature. Everything runs off the default key;
          give a feature its own only when you want its quota separate. Keys are
          encrypted with the OS keychain, never leave the main process, and are
          deliberately not part of backups.
        </p>

        <div className="mt-4 space-y-2">
          {KEY_SLOTS.map((slot) => (
            <KeyRow
              key={slot}
              slot={slot}
              status={statuses[slot] ?? null}
              onChanged={() => void loadStatuses()}
              onError={setError}
            />
          ))}
        </div>
      </section>

      <section className="mb-4 rounded-xl border border-line-soft bg-surface/70 p-5">
        <h2 className="text-[14px] tracking-[-0.01em]">Rate limit</h2>
        <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-ink-faint">
          The most AI calls any one feature may make in a minute. A stuck loop
          hits this wall instead of your quota.
        </p>

        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={60}
            value={rate ?? ''}
            onChange={(e) => setRate(Number(e.target.value))}
            className="w-20 rounded-lg border border-line-soft bg-canvas/60 px-2.5 py-1.5 text-[13px] tabular-nums outline-none transition-colors focus:border-line"
            aria-label="Calls per minute"
          />
          <span className="text-[12px] text-ink-faint">calls a minute</span>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            disabled={rate === null}
            onClick={() => {
              if (rate === null) return
              api.settings
                .setRate(rate)
                .then(setRate)
                .catch((err) =>
                  setError(err instanceof Error ? err.message : String(err))
                )
            }}
            className="rounded-lg bg-amber/20 px-3 py-1.5 text-[12px] text-amber-soft transition-colors hover:bg-amber/30 disabled:opacity-35"
          >
            Save
          </motion.button>
        </div>
      </section>

      <section className="rounded-xl border border-line-soft bg-surface/70 p-5">
        <h2 className="text-[14px] tracking-[-0.01em]">Project homes</h2>
        <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-ink-faint">
          Where a new project of each kind is created. Repositories usually want
          somewhere small and backed up; footage usually wants a scratch drive.
        </p>

        <div className="mt-3 space-y-2">
          {PROJECT_KINDS.map((kind) => (
            <HomeRow
              key={kind}
              kind={kind}
              homes={homes}
              onPick={() => void pickHome(kind)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; models: number }
  | { kind: 'failed'; message: string }

function KeyRow({
  slot,
  status,
  onChanged,
  onError
}: {
  slot: KeySlot
  status: KeyStatus | null
  onChanged(): void
  onError(message: string): void
}) {
  const meta = KEY_SLOT_LABEL[slot]
  const [value, setValue] = useState('')
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await work()
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-line-soft/70 bg-canvas/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[150px]">
          <span className="block text-[12px] text-ink">{meta.label}</span>
          <span className="block text-[10.5px] text-ink-faint">
            {meta.hint}
          </span>
        </div>

        <span
          className={cn(
            'rounded-full border px-2 py-px text-[10px]',
            status?.present
              ? 'border-cat-learn/40 text-cat-learn'
              : 'border-line-soft text-ink-faint'
          )}
        >
          {status?.present
            ? 'key saved'
            : slot === 'default'
              ? 'no key'
              : 'uses default'}
        </span>

        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={status?.present ? 'Replace key…' : 'Paste key…'}
          autoComplete="off"
          spellCheck={false}
          className="min-w-[160px] flex-1 rounded-lg border border-line-soft bg-canvas/60 px-2.5 py-1 font-mono text-[11.5px] outline-none transition-colors placeholder:font-sans placeholder:text-ink-faint/50 focus:border-line"
        />

        <button
          type="button"
          disabled={busy || !value.trim()}
          onClick={() =>
            void run(async () => {
              await api.settings.setKey(value.trim(), slot)
              setValue('')
              setTest({ kind: 'idle' })
            })
          }
          className="rounded-md bg-amber/20 px-2.5 py-1 text-[11px] text-amber-soft transition-colors hover:bg-amber/30 disabled:opacity-35"
        >
          Save
        </button>

        <button
          type="button"
          disabled={busy || (!value.trim() && !status?.present)}
          onClick={() => {
            setTest({ kind: 'testing' })
            api.settings
              .testKey(value.trim() || undefined, slot)
              .then(({ models }) => setTest({ kind: 'ok', models }))
              .catch((err) =>
                setTest({
                  kind: 'failed',
                  message: err instanceof Error ? err.message : String(err)
                })
              )
          }}
          className="rounded-md border border-line-soft px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-35"
        >
          {test.kind === 'testing' ? 'Testing…' : 'Test'}
        </button>

        {status?.present && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => api.settings.clearKey(slot).then(() => undefined))}
            className="rounded-md px-2 py-1 text-[11px] text-ink-faint transition-colors hover:bg-line hover:text-ink disabled:opacity-35"
          >
            Clear
          </button>
        )}
      </div>

      {test.kind === 'ok' && (
        <p className="mt-1 text-[10.5px] text-cat-learn">
          Works — {test.models} models visible.
        </p>
      )}
      {test.kind === 'failed' && (
        <p className="mt-1 text-[10.5px] text-amber-soft">{test.message}</p>
      )}
      {status?.encryptionAvailable === false && (
        <p className="mt-1 text-[10.5px] text-amber-soft">
          The OS keychain is unavailable, so keys cannot be stored securely and
          saving is disabled.
        </p>
      )}
    </div>
  )
}

function HomeRow({
  kind,
  homes,
  onPick
}: {
  kind: ProjectKind
  homes: ProjectHomes | null
  onPick(): void
}) {
  const home = homes?.[kind] ?? null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line-soft/70 bg-canvas/30 px-3 py-2">
      <span className="w-[86px] text-[12px] capitalize text-ink">{kind}</span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate font-mono text-[11px]',
          home ? 'text-ink-dim' : 'text-ink-faint'
        )}
      >
        {home ?? 'Not chosen yet — the first New project asks.'}
      </span>
      <button
        type="button"
        onClick={onPick}
        className="rounded-md border border-line-soft px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:border-line hover:text-ink"
      >
        {home ? 'Change…' : 'Choose…'}
      </button>
    </div>
  )
}
