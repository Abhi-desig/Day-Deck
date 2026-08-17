import {
  PROVIDER_INFO,
  isAiProvider,
  videoProviders,
  type AiModel,
  type AiProvider,
  type KeySlot,
  type SlotConfig,
  type VideoWire
} from '@shared/types'
import type { Db } from '../../db'
import { getSetting, setSetting, SLOT_SETTING } from '../../db/settings'
import { getApiKey } from '../secrets'
import { AiError, type CallContext } from './http'
import type { JsonRequest, TextRequest, WireAdapter } from './wire'
import { anthropicWire } from './anthropic'
import { geminiWire } from './gemini'
import { openaiWire } from './openai'
import { soraVideo } from './sora'
import { veoVideo } from './veo'
import type { VideoAdapter } from './video-wire'

/**
 * Which adapter speaks which dialect.
 *
 * The table is keyed by wire rather than by provider on purpose: adding a
 * vendor that speaks chat-completions is an entry in `PROVIDER_INFO` and
 * nothing else, which is what makes "connect any key" a configuration change
 * rather than a code change.
 */
const WIRES: Record<string, WireAdapter> = {
  gemini: geminiWire,
  openai: openaiWire,
  anthropic: anthropicWire
}

/**
 * Gemini, for anyone who was here before there was a choice.
 *
 * Every existing install has a Gemini key in the default slot and no provider
 * setting at all, so the fallback is not a preference — it is what keeps those
 * installs working across the upgrade without a migration.
 */
const FALLBACK: AiProvider = 'gemini'

/** The provider a slot is set to *in its own right*, or null if it inherits. */
function ownProvider(db: Db, slot: KeySlot): AiProvider | null {
  const raw = getSetting(db, SLOT_SETTING.provider(slot))
  return isAiProvider(raw) ? raw : null
}

/**
 * How a slot is configured, resolving the inheritance.
 *
 * A slot with nothing of its own follows the default slot, the same way its key
 * does — so one provider and one key in the default slot still runs the whole
 * app, which is the promise the slots were introduced with.
 */
export function slotConfig(db: Db, slot: KeySlot): SlotConfig {
  const own = ownProvider(db, slot)
  const provider = own ?? (slot === 'default' ? FALLBACK : inheritedProvider(db))
  // A `custom` slot that inherits also inherits where to send the request;
  // splitting those would give it a provider with nowhere to call.
  const from = own || slot === 'default' ? slot : 'default'

  return {
    slot,
    provider,
    inherited: own === null && slot !== 'default',
    baseUrl: getSetting(db, SLOT_SETTING.baseUrl(from))?.trim() ?? '',
    model: getSetting(db, SLOT_SETTING.model(slot))?.trim() ?? ''
  }
}

const inheritedProvider = (db: Db): AiProvider =>
  ownProvider(db, 'default') ?? FALLBACK

/**
 * `''` clears the slot's own choice and hands it back to the default slot.
 *
 * Worth supporting rather than making the user re-pick the same provider by
 * hand: "follow the default" is a different statement from "be Gemini", and
 * only the first one keeps following when the default changes.
 */
export function setSlotProvider(
  db: Db,
  slot: KeySlot,
  provider: AiProvider | ''
): SlotConfig {
  if (slot === 'default' && !provider) {
    throw new AiError(
      'The default slot has nothing to inherit from — pick a provider for it.',
      'config'
    )
  }

  setSetting(db, SLOT_SETTING.provider(slot), provider)
  // The saved model belongs to the provider that was there a moment ago. Model
  // ids do not survive a vendor change, and a stale one is a 404 on the next
  // call — with a message about a missing model rather than about the switch
  // that caused it.
  setSetting(db, SLOT_SETTING.model(slot), '')
  return slotConfig(db, slot)
}

export function setSlotBaseUrl(db: Db, slot: KeySlot, url: string): SlotConfig {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (trimmed && !/^https?:\/\//i.test(trimmed)) {
    throw new AiError(
      'A custom base URL has to start with http:// or https://.',
      'config'
    )
  }
  setSetting(db, SLOT_SETTING.baseUrl(slot), trimmed)
  return slotConfig(db, slot)
}

export function setSlotModel(db: Db, slot: KeySlot, model: string): SlotConfig {
  setSetting(db, SLOT_SETTING.model(slot), model.trim())
  return slotConfig(db, slot)
}

/**
 * Where a slot's requests actually go.
 *
 * `custom` is the only provider that asks, because it is the only one whose
 * endpoint this app cannot know — a local Ollama, an LM Studio, a company
 * gateway.
 */
function resolveBaseUrl(config: SlotConfig): string {
  const info = PROVIDER_INFO[config.provider]
  const url = (info.baseUrl || config.baseUrl).replace(/\/+$/, '')

  if (!url) {
    throw new AiError(
      `The ${config.slot} slot is set to ${info.label} but has no base URL. Add the server's OpenAI-compatible URL in Settings — something like http://localhost:11434/v1.`,
      'config'
    )
  }
  return url
}

/**
 * The key a slot calls with.
 *
 * The fallback to the default slot's key is deliberately refused when the two
 * slots are different vendors. A key is only meaningful to the provider it came
 * from, so borrowing one across vendors cannot succeed — it produces an
 * authentication failure whose message points at the key rather than at the
 * mismatch that caused it, which is the single most confusing way this could
 * fail.
 */
function resolveKey(db: Db, config: SlotConfig): string {
  const own = getApiKey(config.slot)
  if (own) return own

  const label = PROVIDER_INFO[config.provider].label

  if (config.slot !== 'default') {
    const fallbackProvider = slotConfig(db, 'default').provider
    if (fallbackProvider !== config.provider) {
      throw new AiError(
        `The ${config.slot} slot is set to ${label}, but only the default slot has a key and that one is ${PROVIDER_INFO[fallbackProvider].label}. Give the ${config.slot} slot its own ${label} key in Settings, or set it back to ${PROVIDER_INFO[fallbackProvider].label}.`,
        'config'
      )
    }
    const shared = getApiKey('default')
    if (shared) return shared
  }

  throw new AiError(
    `No ${label} API key is saved. Add one in Settings before generating.`,
    'config'
  )
}

/**
 * The model a slot asks for.
 *
 * A provider's own default is a fallback, not a recommendation — the model list
 * in Settings is read live from the provider, so anything hardcoded here is
 * only ever a guess that saves a first-run round trip. Providers with no
 * sensible guess (OpenRouter, a custom server) say so rather than inventing an
 * id that would 404.
 *
 * The video slot falls back to a *video* default, which is the whole reason
 * `defaultVideoModel` exists. It used to share `defaultModel` with every other
 * slot, so an install that had never opened Settings sent `gemini-3.5-flash` to
 * a video endpoint and got a 404 about a missing model — on a slot nobody had
 * configured, for a button that looked like it should just work.
 */
export function modelFor(db: Db, slot: KeySlot): string {
  const config = slotConfig(db, slot)
  if (config.model) return config.model

  const info = PROVIDER_INFO[config.provider]
  const fallback = slot === 'video' ? info.defaultVideoModel : info.defaultModel
  if (fallback) return fallback

  throw new AiError(
    slot === 'video'
      ? `No video model is chosen for the video slot, and ${info.label} has no default worth guessing. Pick one from the video slot's model list in Settings.`
      : `No model is chosen for the ${slot} slot. Pick one from the ${info.label} list in Settings.`,
    'config'
  )
}

/** Everything one call needs, resolved together so it cannot half-resolve. */
export function callContext(db: Db, slot: KeySlot): CallContext {
  const config = slotConfig(db, slot)
  return {
    provider: config.provider,
    label: PROVIDER_INFO[config.provider].label,
    baseUrl: resolveBaseUrl(config),
    apiKey: resolveKey(db, config)
  }
}

const adapterFor = (provider: AiProvider): WireAdapter =>
  WIRES[PROVIDER_INFO[provider].wire]

/**
 * Which adapter makes video, keyed by dialect.
 *
 * The video counterpart of `WIRES`, and the reason the video slot is not
 * hardcoded to Google: pointing the slot at a new provider is a
 * `PROVIDER_INFO` entry when it speaks a dialect already here, and one new file
 * beside `veo.ts` when it speaks its own.
 */
const VIDEO_WIRE_ADAPTERS: Record<VideoWire, VideoAdapter> = {
  veo: veoVideo,
  sora: soraVideo
}

/**
 * The adapter for a slot's provider, or a refusal that names the alternatives.
 *
 * Most providers in `PROVIDER_INFO` route *language* models and have no video
 * endpoint at all — OpenRouter, Groq, DeepSeek and the rest. A key that works
 * perfectly for prompts therefore cannot generate a clip, however it is
 * configured, and the useful thing to say is which providers can. Left to fail
 * on the wire this arrives as a 404 about a missing model, which sends people
 * looking for the wrong problem.
 */
export function videoAdapterFor(provider: AiProvider): VideoAdapter {
  const wire = PROVIDER_INFO[provider].videoWire
  if (wire) return VIDEO_WIRE_ADAPTERS[wire]

  const able = videoProviders()
    .map((p) => PROVIDER_INFO[p].label)
    .join(', ')

  throw new AiError(
    `${PROVIDER_INFO[provider].label} does not generate video — it routes language models, so a key for it cannot produce a clip however the slot is configured. ` +
      `Set the video slot to one of: ${able || 'none configured'} — and give that slot its own key, since a key only works with the vendor it came from.`,
    'config'
  )
}

/* ------------------------------------------------------------- the calls */

/**
 * The provider's model list.
 *
 * `key` overrides the saved one so Settings can test a key that has not been
 * saved yet — which is the only way to find out whether it works before
 * committing it to the keychain.
 */
export async function listModels(
  db: Db,
  slot: KeySlot,
  key?: string
): Promise<AiModel[]> {
  const config = slotConfig(db, slot)
  const ctx = key?.trim()
    ? {
        provider: config.provider,
        label: PROVIDER_INFO[config.provider].label,
        baseUrl: resolveBaseUrl(config),
        apiKey: key.trim()
      }
    : callContext(db, slot)

  // The video slot asks a different question of the same endpoint: not "what
  // can hold a conversation" but "what can generate a clip this app knows how
  // to collect". Routed here rather than inside the adapter because it is a
  // property of the *slot*, and `WireAdapter` deliberately has no video in it.
  if (slot === 'video') return videoAdapterFor(config.provider).listModels(ctx)

  return adapterFor(config.provider).listModels(ctx)
}

export async function generateJson(
  db: Db,
  slot: KeySlot,
  req: JsonRequest
): Promise<string> {
  const ctx = callContext(db, slot)
  return adapterFor(ctx.provider).generateJson(ctx, req)
}

export async function generateText(
  db: Db,
  slot: KeySlot,
  req: TextRequest
): Promise<string> {
  const ctx = callContext(db, slot)
  return adapterFor(ctx.provider).generateText(ctx, req)
}

export { AiError } from './http'
export type { CallContext } from './http'
export type { JsonRequest, TextRequest, WireAdapter } from './wire'
