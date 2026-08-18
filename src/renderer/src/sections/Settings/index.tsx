import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  KEY_SLOTS,
  PROJECT_KINDS,
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
import { KeyRow } from './Keys'
import { Processes } from './Processes'

/**
 * Settings: the API keys, the rate limit, the process prompts, and where
 * projects live.
 *
 * Split across four files since the prompt desk arrived — `Keys.tsx` holds the
 * per-slot rows, `Processes.tsx` and `ProcessBox.tsx` the desk — because this
 * file was already 912 lines and the desk roughly doubles it.
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
          Appearance, keys, prompts, rate limits, and where things live
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

      {/* After the keys and the rate, because a process is a thing a key pays
          for — and before Project homes, which is about disk rather than AI. */}
      <Processes onError={setError} />

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
