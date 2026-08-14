/**
 * The sentence an IPC failure should actually show.
 *
 * Electron rejects `invoke` with the handler's error flattened into a string:
 * `Error invoking remote method 'boards:planScenes': AiError: Google Gemini is
 * overloaded…`. The channel name and the class name are machinery — they are
 * addressed to whoever wrote the handler, not to whoever is waiting on the
 * plan — and printing them in front of a message written for a person is how a
 * careful explanation ends up reading like a crash.
 *
 * Only the leading machinery is stripped. Anything the main process meant to
 * say survives verbatim, including a colon in the middle of it.
 */
const IPC_WRAPPER = /^Error invoking remote method '[^']*':\s*/
const ERROR_CLASS = /^[A-Za-z]*Error:\s*/

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const cleaned = raw.replace(IPC_WRAPPER, '').replace(ERROR_CLASS, '').trim()
  return cleaned || 'Something went wrong.'
}
