/**
 * Removes the `aps-environment` entitlement that expo-notifications adds.
 *
 * expo-notifications requests the Push Notifications capability during
 * prebuild whether or not the app uses remote push. This app does not:
 * v1 is local notifications only, decided in docs/PLAN.md because remote
 * push needs an APNs key, which needs a paid Apple Developer membership.
 *
 * Keeping the entitlement is not merely redundant, it is fatal to a local
 * build. A free Apple ID gets a "Personal Team", and Apple refuses to
 * issue a development provisioning profile carrying Push Notifications to
 * one:
 *
 *   error: Cannot create a iOS App Development provisioning profile for
 *   "com.delimiters.chorus". Personal development teams do not support the
 *   Push Notifications capability.
 *
 * Local notifications need no entitlement at all — they never touch APNs —
 * so dropping this costs nothing that v1 uses, and is what allows the app
 * to be signed and installed on a real iPhone for free.
 *
 * When remote push arrives it will come with the paid membership that makes
 * the entitlement grantable, and this plugin should be deleted in the same
 * change. See docs/RELEASE.md.
 */

const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
