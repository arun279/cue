package app.cuetracker.cuenative

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads what the Capacitor build left in shared preferences.
 *
 * Capacitor Preferences namespaces by a group that defaults to
 * `CapacitorStorage`, and on Android that group is the file name while the key
 * is stored unprefixed. iOS prefixes the group onto the key inside
 * `UserDefaults` instead. The two shapes are not the same, and a migration that
 * assumes one reads nothing on the other platform, so the difference is
 * expressed here rather than in shared code.
 */
class CueLegacyPreferencesModule : Module() {
    private companion object {
        const val GROUP = "CapacitorStorage"
    }

    override fun definition() = ModuleDefinition {
        Name("CueLegacyPreferences")

        AsyncFunction("read") { key: String ->
            preferences().getString(key, null)
        }

        AsyncFunction("remove") { key: String ->
            preferences().edit().remove(key).apply()
        }
    }

    private fun preferences() =
        (appContext.reactContext ?: throw Exceptions.ReactContextLost())
            .getSharedPreferences(GROUP, Context.MODE_PRIVATE)
}
