/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "localization", () => {
  return new Localization(
    ["toolkit/enterprise/enterprise.ftl", "branding/brand.ftl"],
    true
  );
});

ChromeUtils.defineESModuleGetters(lazy, {
  initiateShutdown:
    "resource://gre/modules/enterprise/EnterpriseCommon.sys.mjs",
  RelaunchEnforcer:
    "resource://gre/modules/enterprise/RelaunchEnforcer.sys.mjs",
});

const PROMPT_ON_SIGNOUT_PREF = "enterprise.prompt_on_signout";

const RELAUNCH_NOTIFICATION_ID = "enterprise-relaunch";

const relaunchUI = {
  _notificationBoxes: new WeakMap(),

  /**
   * Shows or updates the relaunch warning in every ready mail window.
   *
   * @param {object} details
   * @param {"warning"|"imminent"} details.phase - Warning severity.
   * @param {number} details.restartAt - Restart deadline in epoch milliseconds.
   * @param {number} details.minutes - Whole minutes remaining.
   * @param {function(): void} details.restartNow - Requests the restart.
   * @returns {Promise<boolean>} Whether at least one warning is visible.
   */
  async showOrUpdate({ phase, restartAt, minutes, restartNow }) {
    let shown = false;
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      if (win.document.readyState !== "complete") {
        continue;
      }
      try {
        const box = this._getNotificationBox(win);
        const label = {
          "l10n-id":
            phase === "imminent"
              ? "enterprise-relaunch-imminent-message"
              : "enterprise-relaunch-warning-message",
          "l10n-args":
            phase === "imminent" ? { minutes } : { datetime: restartAt },
        };
        const priority =
          phase === "imminent"
            ? box.PRIORITY_CRITICAL_HIGH
            : box.PRIORITY_INFO_HIGH;
        let notification = box.getNotificationWithValue(
          RELAUNCH_NOTIFICATION_ID
        );
        if (notification) {
          notification.label = label;
          notification.priority = priority;
          notification.setAttribute(
            "type",
            phase === "imminent" ? "critical" : "info"
          );
        } else {
          notification = await box.appendNotification(
            RELAUNCH_NOTIFICATION_ID,
            { label, priority },
            [
              {
                "l10n-id": "enterprise-relaunch-restart-now",
                callback() {
                  restartNow();
                  return true;
                },
              },
            ],
            false,
            false
          );
        }
        shown = true;
      } catch (error) {
        console.error("EnterpriseHandler: relaunch warning failed:", error);
      }
    }
    return shown;
  },

  hide() {
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      const box = this._notificationBoxes.get(win);
      const notification = box?.getNotificationWithValue(
        RELAUNCH_NOTIFICATION_ID
      );
      if (notification) {
        box.removeNotification(notification, true);
      }
    }
  },

  isVisible() {
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      if (
        this._notificationBoxes
          .get(win)
          ?.getNotificationWithValue(RELAUNCH_NOTIFICATION_ID)
      ) {
        return true;
      }
    }
    return false;
  },

  _getNotificationBox(win) {
    let box = this._notificationBoxes.get(win);
    if (!box) {
      box = new win.MozElements.NotificationBox(element => {
        element.setAttribute("notificationside", "bottom");
        win.document
          .getElementById("messenger-notification-bottom")
          .append(element);
      });
      this._notificationBoxes.set(win, box);
    }
    return box;
  },
};

export const EnterpriseHandler = {
  relaunchUI,
  /**
   * Shows the sign-out confirmation prompt, unless the user opted out of it.
   *
   * @param {Window} window - Chrome window the modal prompt is anchored to.
   * @returns {Promise<boolean>} true if the sign-out should proceed, false if
   *   the user cancelled.
   */
  async showSignoutPrompt(window) {
    const warnOnSignout = Services.prefs.getBoolPref(
      PROMPT_ON_SIGNOUT_PREF,
      true
    );

    // If the user has disabled the prompt, we can skip showing the prompt.
    if (!warnOnSignout) {
      return true;
    }

    const flags =
      Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0 +
      Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1 +
      Services.prompt.BUTTON_POS_0_DEFAULT;

    const [title, message, reauthNotice, checkLabel, signoutBtnLabel] =
      await lazy.localization.formatValues([
        { id: "enterprise-close-prompt-title" },
        { id: "enterprise-close-prompt-message" },
        { id: "enterprise-close-prompt-message-reauth" },
        { id: "enterprise-close-prompt-checkbox-label" },
        { id: "enterprise-close-prompt-primary-btn-label" },
      ]);

    // buttonPressed will be 0 for Signout and 1 for Cancel
    const result = await Services.prompt.asyncConfirmEx(
      window.browsingContext,
      Services.prompt.MODAL_TYPE_WINDOW,
      title,
      `${message}\n\n${reauthNotice}`,
      flags,
      signoutBtnLabel,
      null,
      null,
      checkLabel,
      true // checkbox checked
    );

    if (result.get("buttonNumClicked") !== 0) {
      // User cancelled signout. Also ignore any checkbox toggling.
      return false;
    }

    Services.prefs.setBoolPref(PROMPT_ON_SIGNOUT_PREF, result.get("checked"));

    // User confirmed signout. Proceed with signout in `onSignOut`.
    return true;
  },

  /**
   * Handles the sign out button in the enterprise panel. Shows the sign-out
   * confirmation prompt then performs a full sign out and quits.
   *
   * @param {Window} window - Chrome window the command was invoked from.
   */
  async onSignOut(window) {
    if (!(await this.showSignoutPrompt(window))) {
      return;
    }

    lazy.initiateShutdown();
  },
};

/** The "enterprise-relaunch-warning-ui" entry point (see components.conf). */
export function registerRelaunchWarningUI() {
  lazy.RelaunchEnforcer.registerWarningUIDelegate(EnterpriseHandler.relaunchUI);
}
