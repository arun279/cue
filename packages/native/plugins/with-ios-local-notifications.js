const { withEntitlementsPlist } = require("expo/config-plugins");

// expo-notifications' plugin always writes aps-environment, which a profile without push cannot sign.
module.exports = (config) =>
  withEntitlementsPlist(config, (entitlements) => {
    delete entitlements.modResults["aps-environment"];
    return entitlements;
  });
