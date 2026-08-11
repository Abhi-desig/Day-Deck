import { app } from 'electron'

/**
 * Open Day Deck at login.
 *
 * Off unless asked for. A planner is a reasonable thing to want at login — the
 * whole point is seeing the day before the day starts — but an app that decides
 * that for you is one you uninstall.
 *
 * `openAsHidden` keeps it out of the way: the window is created but not brought
 * forward, so the rollover and weekly seeding that run at launch have already
 * happened by the time you go looking for it.
 */
export function launchAtLoginEnabled(): boolean {
  return app.getLoginItemSettings().openAtLogin
}

export function setLaunchAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: enabled
  })
}
