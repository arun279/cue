import ExpoModulesCore

/// Reads what the Capacitor build left in `UserDefaults`.
///
/// Capacitor Preferences namespaces by a group that defaults to
/// `CapacitorStorage`, and on iOS that group plus a dot is prefixed onto every
/// key, so the stored name is `CapacitorStorage.cue.trakt.token`. Android puts
/// the group in the file name and leaves the key alone. The two shapes are not
/// the same, and a migration that assumes one reads nothing on the other
/// platform, so the prefix is applied here rather than in shared code.
///
/// React Native's own `Settings` module wraps `NSUserDefaults` and is documented
/// as iOS-only, which would cover half the job; Android needs a native module
/// regardless, so both platforms go through this one.
public class CueLegacyPreferencesModule: Module {
    private static let prefix = "CapacitorStorage."

    public func definition() -> ModuleDefinition {
        Name("CueLegacyPreferences")

        AsyncFunction("read") { (key: String) -> String? in
            UserDefaults.standard.string(forKey: Self.prefix + key)
        }

        AsyncFunction("remove") { (key: String) in
            UserDefaults.standard.removeObject(forKey: Self.prefix + key)
        }
    }
}
