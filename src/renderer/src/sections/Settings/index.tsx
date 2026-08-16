import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
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
    /* Capped rather than full-bleed: these are label-and-control rows, and on a
       wide window an un-capped column stretches a key field to 1,200px and puts
       its Save button half a screen away from the label it belongs to. */
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 pb-7">
      <div className="w-full max-w-[880px]">
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
    <div className="rounded-lg border border-line-soft/70 bg-canvas/30 px-3.5 py-3">
      {/* The slot's identity gets its own line rather than a column beside the
          controls. It reads as a heading, which is what it is, and it frees the
          controls below to line up on one label column instead of being pushed
          along by however long the hint happens to be. */}
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] text-ink">{meta.label}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">
          {meta.hint}
        </span>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-px text-[10px]',
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
      </div>

      <div className="mt-2.5 space-y-1.5">
        <Field label="Provider">
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
            className="w-[210px] shrink-0 rounded-md border border-line-soft bg-canvas/60 px-2 py-1.5 text-[11.5px] text-ink outline-none transition-colors focus:border-line disabled:opacity-35"
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

          {info.docsUrl && !config?.inherited && (
            <span className="truncate text-[11px] text-ink-faint">
              Keys from {info.label} only — one vendor&rsquo;s key is always
              refused by another.
            </span>
          )}
        </Field>

        {needsBaseUrl && (
          <BaseUrlRow
            slot={slot}
            value={config?.baseUrl ?? ''}
            busy={busy}
            onSave={(url) =>
              void run(() =>
                api.settings.setBaseUrl(slot, url).then(() => undefined)
              )
            }
          />
        )}

        <Field label="API key">
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
            aria-label={`${meta.label} API key`}
            className="min-w-0 flex-1 rounded-md border border-line-soft bg-canvas/60 px-2.5 py-1.5 font-mono text-[11.5px] outline-none transition-colors placeholder:font-sans placeholder:text-ink-faint/50 focus:border-line disabled:opacity-50"
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
            className="shrink-0 rounded-md bg-amber/20 px-2.5 py-1.5 text-[11px] text-amber-soft transition-colors hover:bg-amber/30 disabled:opacity-35"
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
                .then(({ models: count }) =>
                  setTest({ kind: 'ok', models: count })
                )
                .catch((err) =>
                  setTest({ kind: 'failed', message: errorMessage(err) })
                )
            }}
            className="shrink-0 rounded-md border border-line-soft px-2.5 py-1.5 text-[11px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-35"
          >
            {test.kind === 'testing' ? 'Testing…' : 'Test'}
          </button>

          {status?.present && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api.settings.clearKey(slot).then(() => undefined)
                )
              }
              className="shrink-0 rounded-md px-2 py-1.5 text-[11px] text-ink-faint transition-colors hover:bg-line hover:text-ink disabled:opacity-35"
            >
              Clear
            </button>
          )}
        </Field>

        <Field label="Model">
          <ModelPicker
            label={meta.label}
            chosen={config?.model ?? ''}
            fallback={info.defaultModel}
            models={models}
            loading={loadingModels}
            busy={busy}
            onLoad={() => void loadModels()}
            onPick={(model) =>
              void run(() =>
                api.settings.setModel(slot, model).then(() => undefined)
              )
            }
          />
        </Field>
      </div>

      {test.kind === 'ok' && (
        <p className="mt-2 text-[10.5px] text-cat-learn">
          Works — {test.models} models visible on {info.label}.
        </p>
      )}
      {test.kind === 'failed' && (
        <p className="mt-2 text-[10.5px] text-amber-soft">{test.message}</p>
      )}
      {unavailable && (
        <p className="mt-2 text-[10.5px] text-amber-soft">
          The OS keychain is unavailable, so keys cannot be stored securely and
          saving is disabled.
        </p>
      )}
    </div>
  )
}

/**
 * One labelled control row.
 *
 * The label column is a fixed width so provider, key and model line up down the
 * card — the thing the old row could not do, because its label was a sibling of
 * the controls and every following row had to fake the alignment with a
 * hardcoded left padding.
 */
function Field({
  label,
  children
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[62px] shrink-0 text-[11px] text-ink-faint">
        {label}
      </span>
      {children}
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
    <Field label="Server">
      <input
        type="url"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="http://localhost:11434/v1"
        spellCheck={false}
        aria-label={`${slot} base URL`}
        className="min-w-0 flex-1 rounded-md border border-line-soft bg-canvas/60 px-2.5 py-1.5 font-mono text-[11.5px] outline-none transition-colors placeholder:font-sans placeholder:text-ink-faint/50 focus:border-line"
      />
      <button
        type="button"
        disabled={busy || draft.trim() === value}
        onClick={() => onSave(draft)}
        className="shrink-0 rounded-md border border-line-soft px-2.5 py-1.5 text-[11px] text-ink-dim transition-colors hover:border-line hover:text-ink disabled:opacity-35"
      >
        Set URL
      </button>
    </Field>
  )
}

/** 131072 → "131k", 1048576 → "1M". Quoted from the provider, never computed. */
function formatContext(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`
  const millions = tokens / 1_000_000
  return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, '')}M`
}

/**
 * Which model this slot asks for.
 *
 * A searchable list rather than a native `<select>`, for one blunt reason:
 * OpenRouter answers with several hundred models, and a native dropdown of that
 * length is a scroll bar with no way to type at it. Scanning it for
 * `google/gemini-2.5-flash-lite` is not a choice anyone can reasonably make.
 *
 * The list is fetched on demand and never hardcoded — every provider adds and
 * retires models on its own schedule — but it is fetched when the picker
 * *opens* rather than behind a separate button, because "List models" was a
 * step between the user and the only control on the row that mattered.
 *
 * Typing something no model matches is offered as a choice too. A local server
 * behind `custom` may serve a model its `/models` endpoint never lists, and
 * refusing to let the user name it would make those slots unusable.
 */
function ModelPicker({
  label,
  chosen,
  fallback,
  models,
  loading,
  busy,
  onLoad,
  onPick
}: {
  /** The slot's human name, for the control's accessible label. */
  label: string
  chosen: string
  fallback: string
  models: AiModel[] | null
  loading: boolean
  busy: boolean
  onLoad(): void
  onPick(model: string): void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const list = models ?? []
    const q = query.trim().toLowerCase()
    if (!q) return list
    // Substring on both id and display name: people search for "flash" and for
    // "google/" about equally.
    return list.filter((m) =>
      `${m.id} ${m.displayName}`.toLowerCase().includes(q)
    )
  }, [models, query])

  const typed = query.trim()
  const offerTyped =
    typed !== '' && !(models ?? []).some((m) => m.id === typed)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  function toggle(): void {
    const next = !open
    setOpen(next)
    if (!next) return
    setQuery('')
    // First open pays for the list; reopening spends nothing. Five slots
    // fetching on mount would be five outbound calls every time this panel
    // opens, mostly for slots nobody is editing.
    if (models === null && !loading) onLoad()
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function choose(model: string): void {
    onPick(model)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        disabled={busy}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label} model`}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border bg-canvas/60 px-2.5 py-1.5 text-left transition-colors',
          open ? 'border-line' : 'border-line-soft hover:border-line',
          'disabled:opacity-35'
        )}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-mono text-[11.5px]',
            chosen ? 'text-ink' : 'text-ink-faint'
          )}
        >
          {chosen || fallback || 'Pick a model…'}
        </span>
        {!chosen && fallback && (
          <span className="shrink-0 text-[10px] text-ink-faint">
            provider default
          </span>
        )}
        <svg viewBox="0 0 10 6" className="size-2.5 shrink-0 text-ink-faint" aria-hidden>
          <path
            d="M1 1l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-lg border border-hairline-strong bg-surface modal-shadow"
          >
            <div className="flex items-center gap-2 border-b border-line-soft px-2.5 py-2">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setOpen(false)
                  }
                  // Enter on a search that matches one model picks it; on a
                  // search that matches none, it names the model by hand.
                  if (e.key === 'Enter') {
                    if (results.length === 1) choose(results[0].id)
                    else if (offerTyped) choose(typed)
                  }
                }}
                placeholder={
                  models
                    ? `Search ${models.length} models…`
                    : loading
                      ? 'Loading the list…'
                      : 'Search, or type a model id…'
                }
                spellCheck={false}
                aria-label={`Search ${label} models`}
                className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] outline-none placeholder:font-sans placeholder:text-ink-faint/60"
              />
              <button
                type="button"
                disabled={loading}
                onClick={onLoad}
                className="shrink-0 text-[10.5px] text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
              >
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            <div role="listbox" className="max-h-[240px] overflow-y-auto p-1">
              {fallback && !query.trim() && (
                <Option
                  selected={chosen === ''}
                  onPick={() => choose('')}
                  primary={fallback}
                  secondary="Provider default — follows whatever this provider recommends"
                />
              )}

              {results.map((m) => (
                <Option
                  key={m.id}
                  selected={m.id === chosen}
                  onPick={() => choose(m.id)}
                  primary={m.displayName === m.id ? m.id : m.displayName}
                  secondary={m.displayName === m.id ? undefined : m.id}
                  aside={
                    m.inputTokenLimit
                      ? `${formatContext(m.inputTokenLimit)} ctx`
                      : undefined
                  }
                />
              ))}

              {offerTyped && (
                <Option
                  selected={chosen === typed}
                  onPick={() => choose(typed)}
                  primary={typed}
                  secondary={
                    results.length === 0
                      ? 'No model in the list matches — use this id as typed'
                      : 'Use this id exactly as typed'
                  }
                />
              )}

              {models === null && !loading && !offerTyped && (
                <p className="px-2.5 py-5 text-center text-[11.5px] text-ink-faint">
                  Could not read the model list. Check the key above, or type
                  the model id.
                </p>
              )}
              {loading && (
                <p className="px-2.5 py-5 text-center text-[11.5px] text-ink-faint">
                  Asking the provider what it has…
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** One row in the picker. Id in mono, because an id is a thing to be copied. */
function Option({
  selected,
  onPick,
  primary,
  secondary,
  aside
}: {
  selected: boolean
  onPick(): void
  primary: string
  secondary?: string
  aside?: string
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors',
        selected ? 'bg-raised' : 'hover:bg-raised/60'
      )}
    >
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate font-mono text-[11.5px]',
            selected ? 'text-ink' : 'text-ink-dim'
          )}
        >
          {primary}
        </span>
        {secondary && (
          <span className="block truncate text-[10.5px] text-ink-faint">
            {secondary}
          </span>
        )}
      </span>
      {aside && (
        <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
          {aside}
        </span>
      )}
      {selected && (
        <svg viewBox="0 0 12 12" className="size-3 shrink-0 text-amber" aria-hidden>
          <path
            d="M2.5 6.5l2.5 2.5 4.5-5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
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
