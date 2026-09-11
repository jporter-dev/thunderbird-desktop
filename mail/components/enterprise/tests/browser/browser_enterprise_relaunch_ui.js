/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { EnterpriseHandler } = ChromeUtils.importESModule(
  "resource:///modules/enterprise/EnterpriseHandler.sys.mjs"
);
const { RelaunchEnforcer } = ChromeUtils.importESModule(
  "resource://gre/modules/enterprise/RelaunchEnforcer.sys.mjs"
);

const RELAUNCH_NOTIFICATION_ID = "enterprise-relaunch";

add_task(async function test_relaunch_warning_ui() {
  // The delegate is resolved from its components.conf category on first use,
  // so asking for it is what registers Thunderbird's UI.
  Assert.equal(
    RelaunchEnforcer._appWarningUI(),
    EnterpriseHandler.relaunchUI,
    "The warning UI category resolves to Thunderbird's relaunch UI"
  );
  RelaunchEnforcer.cancel();
  registerCleanupFunction(() => RelaunchEnforcer.cancel());

  RelaunchEnforcer.onConsolePoll({
    MinutesRemaining: 45,
    GracePeriodMinutes: 0,
  });
  await RelaunchEnforcer._refreshNotification();

  Assert.ok(
    EnterpriseHandler.relaunchUI.isVisible(),
    "The application UI reports the visible notification"
  );

  const notificationBox =
    EnterpriseHandler.relaunchUI._notificationBoxes.get(window);
  const notification = notificationBox.getNotificationWithValue(
    RELAUNCH_NOTIFICATION_ID
  );
  Assert.equal(
    notification.messageL10nId,
    "enterprise-relaunch-warning-message",
    "The warning uses the shared relaunch message"
  );
  Assert.deepEqual(
    notification.messageL10nArgs,
    { datetime: RelaunchEnforcer._schedule.restartAt },
    "The warning receives the restart deadline"
  );
  await TestUtils.waitForCondition(
    () => notification.messageText.textContent.includes("will restart at"),
    "The warning deadline is rendered"
  );

  RelaunchEnforcer.onConsolePoll({
    MinutesRemaining: 4,
    GracePeriodMinutes: 0,
  });
  await RelaunchEnforcer._refreshNotification();

  Assert.equal(
    notificationBox.getNotificationWithValue(RELAUNCH_NOTIFICATION_ID),
    notification,
    "Escalation updates the existing notification"
  );
  Assert.equal(
    notification.messageL10nId,
    "enterprise-relaunch-imminent-message",
    "Escalation uses the imminent message"
  );
  Assert.deepEqual(
    notification.messageL10nArgs,
    { minutes: 4 },
    "The imminent warning receives the countdown"
  );
  await TestUtils.waitForCondition(
    () =>
      notification.messageText.textContent.includes(
        "will restart in 4 minutes"
      ),
    "The imminent countdown is rendered"
  );
  Assert.equal(notification.getAttribute("type"), "critical");

  let restartRequested = false;
  const originalRestart = RelaunchEnforcer._restart;
  try {
    RelaunchEnforcer._restart = () => {
      restartRequested = true;
    };
    notification._buttons[0].click();
  } finally {
    RelaunchEnforcer._restart = originalRestart;
  }
  Assert.ok(restartRequested, "The restart button invokes the enforcer");

  RelaunchEnforcer.cancel();
  Assert.ok(
    !notificationBox.getNotificationWithValue(RELAUNCH_NOTIFICATION_ID),
    "The warning is removed"
  );
  Assert.ok(
    !EnterpriseHandler.relaunchUI.isVisible(),
    "The application UI reports the notification as hidden"
  );
});
