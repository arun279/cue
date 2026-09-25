const { withEntitlementsPlist } = require("expo/config-plugins");

/**
 * Expo applies expo-notifications' config plugin whenever the package is
 * installed, and that plugin writes `aps-environment` unconditionally. Local
 * notifications need no entitlement, and Cue's provisioning profile carries no
 * push capability, so a build signed with the key would fail.
 */
module.exports = (config) =>
  withEntitlementsPlist(config, (entitlements) => {
    delete entitlements.modResults["aps-environment"];
    return entitlements;
  });
