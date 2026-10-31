package app.cuetracker.cuenative

import android.content.Context
import android.webkit.WebStorage
import android.webkit.WebView
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads, and finally deletes, what the Capacitor build left in shared preferences.
 *
 * Capacitor Preferences namespaces by a group that defaults to
 * `CapacitorStorage`, and on Android that group is the file name while the key
 * is stored unprefixed. iOS prefixes the group onto the key inside
 * `UserDefaults` instead. The two shapes are not the same, and a migration that
 * assumes one reads nothing on the other platform, so the difference is
 * expressed here rather than in shared code.
 *
 * Capacitor Local Notifications kept each reminder, its text included, in a
 * shared preferences file of its own, which is deleted with the rest.
 *
 * The Capacitor build ran in a WebView, whose storage still holds its settings
 * and query cache and whose HTTP cache may hold Trakt responses. Both are
 * cleared. Cookies are kept: React Native's networking stores its cookies in
 * the same WebView `CookieManager`.
 */
class CueLegacyPreferencesModule : Module() {
    private companion object {
        const val GROUP = "CapacitorStorage"
        const val NOTIFICATION_STORE = "NOTIFICATION_STORE"
    }

    override fun definition() = ModuleDefinition {
        Name("CueLegacyPreferences")

        AsyncFunction("read") { key: String ->
            preferences().getString(key, null)
        }

        AsyncFunction("remove") { key: String ->
            preferences().edit().remove(key).apply()
        }

        AsyncFunction("clear") {
            preferences().edit().clear().apply()
            context().deleteSharedPreferences(NOTIFICATION_STORE)
        }

        AsyncFunction("clearWebView") {
            WebStorage.getInstance().deleteAllData()
            WebView(context()).run {
                clearCache(true)
                destroy()
            }
        }.runOnQueue(Queues.MAIN)
    }

    private fun context() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

    private fun preferences() = context().getSharedPreferences(GROUP, Context.MODE_PRIVATE)
}
