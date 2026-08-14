import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  AI_PROVIDERS,
  KEY_SLOTS,
  KEY_SLOT_LABEL,
  PROJECT_KINDS,
  PROVIDER_INFO,
  type AiModel,
  type AiProvider,
  type KeySlot,
  type KeyStatus,
  type ProjectHomes,
  type ProjectKind,
  type SlotConfig
} from '@shared/types'
import { cn } from '../../lib/cn'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/error'
import { SPRING } from '../../lib/motion'
import { usePrefs } from '../../store/usePrefs'
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
  const [configs, setConfigs] = useState<Partial<Record<KeySlot, SlotConfig>>>(
    {}
  )
  const [rate, setRate] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const homes = useProjects((s) => s.homes)
  const loadHomes = useProjects((s) => s.loadHomes)
  const pickHome = useProjects((s) => s.pickHome)

  /**
   * Keys and providers, re-read together.
   *
   * Every row's meaning depends on the default slot's — "uses default" is only
   * legible next to what the default actually is — so refreshing one slot
   * refreshes all of them. Cheap: it is a handful of local reads.
   */
  const reload = useCallback(async (): Promise<void> => {
    try {
      const [entries, slotConfigs] = await Promise.all([
        Promise.all(
          KEY_SLOTS.map(
            async (slot) => [slot, await api.settings.keyStatus(slot)] as const
          )
        ),
        api.settings.slotConfigs()
      ])
      setStatuses(Object.fromEntries(entries))
      setConfigs(Object.fromEntries(slotConfigs.map((c) => [c.slot, c])))
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void reload()
    void loadHomes()
    api.settings
      .rate()
      .then(setRate)
      .catch((err) => setError(errorMessage(err)))
  }, [loadHomes, reload])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 pb-7">
      <header className="flex shrink-0 items-baseline gap-3 pb-4">
        <h1 className="text-[19px] font-medium tracking-[-0.02em]">Settings</h1>
        <span className="text-[12.5px] text-ink-faint">
          Appearance, keys, rate limits, and where things live
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

      <Appearance />

      <section className="mb-4 rounded-xl border border-line-soft bg-surface/70 p-5">
        <h2 className="text-[14px] tracking-[-0.01em]">API keys</h2>
        <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-ink-faint">
          One slot per feature, each with its own provider. Everything runs off
          the default slot; give a feature its own only when you want its quota
          — or its vendor — separate. Keys are encrypted with the OS keychain,
          never leave the main process, and are deliberately not part of
          backups.
        </p>

        <div className="mt-4 space-y-2">
          {KEY_SLOTS.map((slot) => (
            <KeyRow
              key={slot}
              slot={slot}
              status={statuses[slot] ?? null}
              config={configs[slot] ?? null}
              defaultProvider={configs.default?.provider ?? 'gemini'}
              onChanged={() => void reload()}
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

/**
 * One slot: who it talks to, what it authenticates with, and which model it
 * asks for.
 *
 * The provider comes first in the row because it changes the meaning of
 * everything after it — the key that is valid, the models that exist, even
 * whether a base URL is a question worth asking. Putting the key first is how
 * the old panel let a Grok key be pasted into a Gemini request and then
 * reported the vendor's rejection as though the key were at fault.
 */
function KeyRow({
  slot,
  status,
  config,
  defaultProvider,
  onChanged,
  onError
}: {
  slot: KeySlot
  status: KeyStatus | null
  config: SlotConfig | null
  /** What "same as default" currently resolves to, for the option's label. */
  defaultProvider: AiProvider
  onChanged(): void
  onError(message: string): void
}) {
  const meta = KEY_SLOT_LABEL[slot]
  const [value, setValue] = useState('')
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<AiModel[] | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)

  const provider = config?.provider ?? 'gemini'
  const info = PROVIDER_INFO[provider]
  /**
   * Only the slot that owns its provider is asked where to send the request.
   *
   * A slot inheriting `custom` inherits the default's URL along with it — that
   * is what following the default means — so offering it a field of its own
   * would show an input whose value is read from somewhere else.
   */
  const needsBaseUrl = info.baseUrl === '' && !config?.inherited
  const unavailable = status?.encryptionAvailable === false

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await work()
      onChanged()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Fetch the model list on demand rather than on mount.
   *
   * Five slots listing their models at once would be five outbound calls every
   * time this panel opens — against the rate limit, and mostly for slots nobody
   * is editing.
   */
  const loadModels = async (): Promise<void> => {
    setLoadingModels(true)
    try {
      setModels(await api.settings.models(slot, value.trim() || undefined))
    } catch (err) {
      onError(errorMessage(err))
      setModels(null)
    } finally {
      setLoadingModels(false)
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

        <select
          value={config?.inherited ? '' : provider}
          disabled={busy}
          aria-label={`${meta.label} provider`}
          onChange={(e) =>
            void run(async () => {
              await api.settings.setProvider(
                slot,
                e.target.value as AiProvider | ''
              )
              // The list belonged to the old vendor.
              setModels(null)
              setTest({ kind: 'idle' })
            })
          }
          className="rounded-md border border-line-soft bg-canvas/60 px-2 py-1 text-[11px] text-ink outline-none transition-colors focus:border-line disabled:opacity-35"
        >
          {/* Only offered where it means something. The default slot has
              nothing to inherit from. */}
          {slot !== 'default' && (
            <option value="">
              Same as default ({PROVIDER_INFO[defaultProvider].label})
            </option>
          )}
          {AI_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_INFO[p].label}
            </option>
          ))}
        </select>

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
          disabled={unavailable}
          placeholder={
            status?.present
              ? 'Replace key…'
              : info.keyHint
                ? `Paste ${info.label} key (${info.keyHint})`
                : `Paste ${info.label} key…`
          }
          autoComplete="off"
          spellCheck={false}
          className="min-w-[160px] flex-1 rounded-lg border border-line-soft bg-canvas/60 px-2.5 py-1 font-mono text-[11.5px] outline-none transition-colors placeholder:font-sans placeholder:text-ink-faint/50 focus:border-line disabled:opacity-50"
        />

        <button
          type="button"
          disabled={busy || unavailable || !value.trim()}
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
              .then(({ models: count }) => setTest({ kind: 'ok', models: count }))
              .catch((err) =>
                setTest({ kind: 'failed', message: errorMessage(err) })
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

      {needsBaseUrl && (
        <BaseUrlRow
          slot={slot}
          value={config?.baseUrl ?? ''}
          busy={busy}
          onSave={(url) =>
            void run(() => api.settings.setBaseUrl(slot, url).then(() => undefined))
          }
        />
      )}

      <ModelRow
        slot={slot}
        chosen={config?.model ?? ''}
        fallback={info.defaultModel}
        models={models}
        loading={loadingModels}
        busy={busy}
        onLoad={() => void loadModels()}
        onPick={(model) =>
          void run(() => api.settings.setModel(slot, model).then(() => undefined))
        }
      />

      {test.kind === 'ok' && (
        <p className="mt-1 text-[10.5px] text-cat-learn">
          Works — {test.models} models visible on {info.label}.
        </p>
      )}
      {test.kind === 'failed' && (
        <p className="mt-1 text-[10.5px] text-amber-soft">{test.message}</p>
      )}
      {unavailable && (
        <p className="mt-1 text-[10.5px] text-amber-soft">
          The OS keychain is unavailable, so keys cannot be stored securely and
          saving is disabled.
        </p>
      )}
    </div>
  )
}

/** Where a custom, OpenAI-compatible server lives. Only shown when there is one. */
function BaseUrlRow({
  slot,
  value,
  busy,
  onSave
}: {
  slot: KeySlot
  value: string
  busy: boolean
  onSave(url: string): void
}) {
  const [draft, setDraft] = useState(value)

  // The saved value is the source of truth; a slot switched to custom arrives
  // with whatever was last stored for it.
  useEffect(() => setDraft(value), [value])

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[150px]">
      <input
        type="url"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="http://localhost:11434/v1"
        spellCheck={false}
        aria-label={`${slot} base URL`}
        className="min-w-[220px] flex-1 rounded-lg border border-line-soft bg-canvas/60 px-2.5 py-1 font-mono text-[11px] outline-none transition-colors placeholder:font-sans placeholder:text-ink-faint/50 focus:border-line"
      />
      <button
        type="button"
        disabled={busy || draft.trim() === value}
        onClick={() => onSave(draft)}
        className="rounded-md border border-line-soft px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-35"
      >
        Set URL
      </button>
    </div>
  )
}

/**
 * Which model this slot asks for.
 *
 * The list is fetched on demand and never hardcoded: every provider here adds
 * and retires models on its own schedule, and a baked-in list would be a
 * silently broken app some months from now.
 */
function ModelRow({
  slot,
  chosen,
  fallback,
  models,
  loading,
  busy,
  onLoad,
  onPick
}: {
  slot: KeySlot
  chosen: string
  fallback: string
  models: AiModel[] | null
  loading: boolean
  busy: boolean
  onLoad(): void
  onPick(model: string): void
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[150px]">
      {models ? (
        <select
          value={chosen}
          disabled={busy}
          aria-label={`${slot} model`}
          onChange={(e) => onPick(e.target.value)}
          className="min-w-[220px] flex-1 rounded-md border border-line-soft bg-canvas/60 px-2 py-1 text-[11px] text-ink outline-none transition-colors focus:border-line disabled:opacity-35"
        >
          <option value="">
            {fallback ? `Provider default (${fallback})` : 'Pick a model…'}
          </option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName === m.id ? m.id : `${m.displayName} — ${m.id}`}
            </option>
          ))}
        </select>
      ) : (
        <span className="min-w-[220px] flex-1 truncate font-mono text-[11px] text-ink-faint">
          {chosen || (fallback ? `${fallback} (provider default)` : 'No model chosen')}
        </span>
      )}

      <button
        type="button"
        disabled={loading || busy}
        onClick={onLoad}
        className="rounded-md border border-line-soft px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-35"
      >
        {loading ? 'Loading…' : models ? 'Refresh models' : 'List models'}
      </button>
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

/**
 * Light or dark.
 *
 * First card in the panel: it is the setting people come looking for, and it is
 * the only one here that changes what the rest of the panel looks like while
 * they are reading it.
 */
function Appearance() {
  const theme = usePrefs((s) => s.theme)
  const setTheme = usePrefs((s) => s.setTheme)
  const light = theme === 'light'

  return (
    <section className="mb-4 rounded-xl border border-line-soft bg-surface/70 p-5">
      <h2 className="text-[14px] tracking-[-0.01em]">Appearance</h2>
      <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-ink-faint">
        Dark is the app's native mode — the deck is built around glass over a lit
        room. Light swaps that for white cards on soft shadows, and takes the
        editor and terminal with it.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={light}
          aria-label="Light theme"
          onClick={() => void setTheme(light ? 'dark' : 'light')}
          className={cn(
            'relative h-[20px] w-[34px] shrink-0 rounded-full transition-colors',
            light ? 'bg-amber' : 'bg-line'
          )}
        >
          <motion.span
            className="absolute top-[2px] size-4 rounded-full bg-canvas"
            initial={false}
            animate={{ left: light ? 16 : 2 }}
            transition={SPRING.snap}
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] text-ink">Light theme</div>
          <div className="text-[11px] text-ink-faint">
            {light ? 'On — white cards, soft shadows.' : 'Off — the dark deck.'}
          </div>
        </div>
      </div>
    </section>
  )
}
