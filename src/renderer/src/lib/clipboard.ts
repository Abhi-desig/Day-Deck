/**
 * Copy text, whichever way this window will allow.
 *
 * `navigator.clipboard` needs a secure context. In dev the renderer is served
 * over http://localhost, which qualifies; in a packaged build it is loaded from
 * `file://`, which does not always. So the async API is tried first and the old
 * execCommand path is kept as the fallback rather than assumed dead — copying a
 * prompt is the entire point of the button, and it failing silently in the
 * shipped app but not in dev is the worst version of this bug.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fall through.
  }

  try {
    const scratch = document.createElement('textarea')
    scratch.value = text
    // Off-screen rather than hidden: `display: none` and `visibility: hidden`
    // are both unselectable, and the selection is what gets copied.
    scratch.style.position = 'fixed'
    scratch.style.top = '-1000px'
    scratch.setAttribute('readonly', '')
    document.body.appendChild(scratch)
    scratch.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(scratch)
    return ok
  } catch {
    return false
  }
}
