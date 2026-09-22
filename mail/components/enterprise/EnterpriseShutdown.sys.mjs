/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ConsoleClient: "resource://gre/modules/enterprise/ConsoleClient.sys.mjs",
});

/**
 * Preserves Thunderbird state before a console-driven forced shutdown.
 */
export const EnterpriseShutdown = {
  _preparationPromise: null,

  /**
   * Flushes application state before ConsoleClient requests the quit.
   *
   * @returns {Promise<void>} Resolves when Thunderbird is ready to quit.
   */
  beforeForcedQuit() {
    this._preparationPromise ??= this._flushState();
    return this._preparationPromise;
  },

  async _flushState() {
    await this._waitForSessionRestore();
    await this._flushComposeWindows();
  },

  async _waitForSessionRestore() {
    if ("sessionRestored" in Services.startup.getStartupInfo()) {
      return;
    }
    await new Promise(resolve => {
      const observer = () => {
        Services.obs.removeObserver(observer, "sessionstore-windows-restored");
        resolve();
      };
      Services.obs.addObserver(observer, "sessionstore-windows-restored");
    });
  },

  async _flushComposeWindows() {
    const flushes = [];
    for (const win of Services.wm.getEnumerator("msgcompose")) {
      flushes.push(
        Promise.resolve(win.flushForForcedShutdown?.()).catch(error =>
          console.error("EnterpriseShutdown: compose flush failed:", error)
        )
      );
    }
    await Promise.all(flushes);
  },
};

/** The "enterprise-forced-quit-hook" entry point (see components.conf). */
export function registerForcedQuitHook() {
  lazy.ConsoleClient.registerBeforeForcedQuitHook(() =>
    EnterpriseShutdown.beforeForcedQuit()
  );
}
