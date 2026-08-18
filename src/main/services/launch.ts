import { app } from 'electron'

/**
 * Open Day Deck at login.
 *
 * Off unless asked for. A planner is a reasonable thing to want at login — the
 * whole point is seeing the day before the day starts — but an app that decides
 * that for you is one you uninstall.
 *
 * **Visible, not hidden.** `openAsHidden: true` was the original choice and it
 * was the wrong one: it starts the app with no window brought forward, so
 * "open at login" produced a dock icon and nothing else, and the deck still had
 * to be summoned by hand. Seeing the day without asking for it is the entire
 * point of the setting, and the launch work — rollover, weekly seeding — has
 * already run by the time the window paints either way, because the window is
 * held back until `ready-to-show`.
 *
 * The result is also the fastest this can be: at login the app is already
 * running and already painted, so there is no launch to wait through.
 */
export function launchAtLoginEnabled(): boolean {
  return app.getLoginItemSettings().openAtLogin
}

export function setLaunchAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    // Explicitly false rather than omitted: macOS remembers the flag from the
    // last call, so an install that had already been told to open hidden would
    // keep doing it.
    openAsHidden: false
  })
}
