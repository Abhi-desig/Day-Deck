import * as monaco from 'monaco-editor/editor/editor.api'
// Every editor contribution — find/replace, folding, multi-cursor, bracket
// matching, the context menu. Deliberately *not*
// `monaco-editor/languages/features/register.all`, which is the css/html/json/
// typescript language services; see NO_WORKER_OPTIONS below.
import 'monaco-editor/features/register.all'
// Monarch grammars for ~80 languages. Pure tokenizers, main thread only.
import 'monaco-editor/basic-languages/monaco.contribution'
import { loader } from '@monaco-editor/react'

/**
 * Monaco, assembled locally and running without web workers.
 *
 * Two deliberate departures from the usual setup:
 *
 * 1. **No CDN.** `@monaco-editor/react` fetches monaco from jsdelivr by
 *    default. This app declares `connect-src 'self'` and is meant to work with
 *    the wifi off, so the editor is bundled and handed to the loader instead.
 *
 * 2. **No language workers.** A packaged Electron renderer is served from
 *    `file://`, where constructing a `Worker` is blocked — the editor would
 *    quietly work in `pnpm dev` and break in the shipped app, which is the
 *    worst kind of difference. So the worker-backed language services are never
 *    imported, and the handful of editor features that would reach for a worker
 *    are turned off explicitly below rather than left to fail at runtime.
 *
 * What survives is everything this pane is for: syntax highlighting, find and
 * replace, folding, multi-cursor, minimap. What does not is cross-file
 * IntelliSense — which is exactly what the "Open in VS Code" button is for.
 */

export const DAY_DECK_THEME = 'day-deck'
export const DAY_DECK_THEME_LIGHT = 'day-deck-light'

monaco.editor.defineTheme(DAY_DECK_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6f6f7d', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'a78bfa' },
    { token: 'string', foreground: '5eead4' },
    { token: 'number', foreground: 'ffc95f' },
    { token: 'type', foreground: '7c9cff' },
    { token: 'function', foreground: 'ffb020' },
    { token: 'variable', foreground: 'f6f6f9' },
    { token: 'delimiter', foreground: '8a8a96' }
  ],
  colors: {
    // Transparent so the workspace's own glass shows through; every other
    // colour is lifted straight from the app's tokens in globals.css.
    'editor.background': '#00000000',
    'editor.foreground': '#f6f6f9',
    'editorLineNumber.foreground': '#4a4a57',
    'editorLineNumber.activeForeground': '#8a8a96',
    'editorCursor.foreground': '#ffb020',
    'editor.selectionBackground': '#ffb02033',
    'editor.inactiveSelectionBackground': '#ffb0201a',
    'editor.lineHighlightBackground': '#ffffff08',
    'editorIndentGuide.background1': '#ffffff0d',
    'editorIndentGuide.activeBackground1': '#ffffff1f',
    'editorWidget.background': '#1c1c22',
    'editorWidget.border': '#35353f',
    'editorGutter.background': '#00000000',
    'scrollbarSlider.background': '#35353f80',
    'scrollbarSlider.hoverBackground': '#3a3a45cc',
    'scrollbarSlider.activeBackground': '#4a4a57cc',
    'minimap.background': '#00000000',
    'editorBracketMatch.background': '#ffb02026',
    'editorBracketMatch.border': '#ffb02066'
  }
})

/*
 * The same theme against a light workspace.
 *
 * Monaco holds its colours in a JS object handed to the library, so it is one of
 * the two places in the app a CSS token swap cannot reach — this has to exist
 * as a second object and be selected by name.
 *
 * The token mapping is identical to the dark theme (keyword violet, string
 * green, number amber, type sky, function amber); only the values move, each
 * lifted from the light palette in globals.css. The background stays
 * transparent for the same reason it is transparent above: the pane behind is
 * glass, and an opaque editor would punch a hole in it.
 */
monaco.editor.defineTheme(DAY_DECK_THEME_LIGHT, {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a6f7d', fontStyle: 'italic' },
    { token: 'keyword', foreground: '7644cb' },
    { token: 'string', foreground: '0b6b53' },
    { token: 'number', foreground: '8a5a00' },
    { token: 'type', foreground: '2a52bd' },
    { token: 'function', foreground: '9a5b00' },
    { token: 'variable', foreground: '1c1e26' },
    { token: 'delimiter', foreground: '5a5f6e' }
  ],
  colors: {
    'editor.background': '#00000000',
    'editor.foreground': '#191b23',
    'editorLineNumber.foreground': '#b0b5c1',
    'editorLineNumber.activeForeground': '#5a5f6e',
    'editorCursor.foreground': '#9a5b00',
    'editor.selectionBackground': '#9a5b0026',
    'editor.inactiveSelectionBackground': '#9a5b0014',
    'editor.lineHighlightBackground': '#0f14230a',
    'editorIndentGuide.background1': '#0f142314',
    'editorIndentGuide.activeBackground1': '#0f142330',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#c3c7d2',
    'editorGutter.background': '#00000000',
    'scrollbarSlider.background': '#c3c7d280',
    'scrollbarSlider.hoverBackground': '#a9aebccc',
    'scrollbarSlider.activeBackground': '#8b90a0cc',
    'minimap.background': '#00000000',
    'editorBracketMatch.background': '#9a5b0020',
    'editorBracketMatch.border': '#9a5b0066'
  }
})

/**
 * If something we missed still asks for a worker, fail loudly here rather than
 * letting monaco fall back to fetching one over the network.
 */
const environment = { getWorker: (): never => {
  throw new Error(
    'Day Deck runs Monaco without web workers. If you are seeing this, an editor feature that needs one was enabled.'
  )
} }
;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = environment

loader.config({ monaco })

/** The editor features that would otherwise reach for a worker on first use. */
const NO_WORKER_OPTIONS = {
  /** Scans the whole model in a worker to suggest words already in the file. */
  wordBasedSuggestions: 'off',
  /** The default link detector is a worker-side regex pass. */
  links: false,
  /** Highlighting other occurrences of the word under the cursor. */
  occurrencesHighlight: 'off',
  /** Confusable-character detection also runs worker-side. */
  unicodeHighlight: {
    ambiguousCharacters: false,
    invisibleCharacters: false,
    nonBasicASCII: false
  }
} as const

export const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  ...NO_WORKER_OPTIONS,
  fontFamily:
    "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 12.5,
  lineHeight: 1.65,
  fontLigatures: true,
  minimap: { enabled: true, renderCharacters: false, maxColumn: 80 },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  renderLineHighlight: 'line',
  renderWhitespace: 'selection',
  padding: { top: 14, bottom: 24 },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  guides: { indentation: true, bracketPairs: 'active' },
  bracketPairColorization: { enabled: true },
  tabSize: 2,
  // No language service means no formatter and no completions to offer; leaving
  // these on just adds keybindings that do nothing.
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  formatOnPaste: false,
  formatOnType: false,
  codeLens: false,
  inlayHints: { enabled: 'off' },
  stickyScroll: { enabled: true },
  automaticLayout: true
}

export { monaco }
