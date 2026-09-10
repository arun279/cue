package app.cuetracker.cuenative

import android.os.Build
import android.view.HapticFeedbackConstants
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Cue's haptic vocabulary on Android.
 *
 * The app names interactions; this answers with the action-oriented
 * [HapticFeedbackConstants] for each, played through the activity's own view.
 * That path is the one Android's haptics guidance recommends first: the OEM
 * tunes each constant for the actuator in that phone, it honours the system
 * Touch feedback setting by contract, and it needs no VIBRATE permission. Raw
 * `Vibrator` waveforms are what the same guidance tells you not to use for touch
 * feedback, and they are what `expo-haptics` uses on this platform.
 *
 * Several constants arrived after this app's minSdk, so each one below names the
 * release it landed in and the older effect that stands in for it.
 */
class CueHapticsModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("CueHaptics")

        /** CONFIRM is API 30. Below it, VIRTUAL_KEY is the platform's baseline
         * "that registered" tap. */
        Function("success") {
            perform(
                if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM
                else HapticFeedbackConstants.VIRTUAL_KEY,
            )
        }

        /** REJECT is API 30, and it is the constant that signals "the
         * interaction did not take". Below it, LONG_PRESS is what androidx's
         * HapticFeedbackConstantsCompat documents as the same feedback. */
        Function("failure") {
            perform(
                if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT
                else HapticFeedbackConstants.LONG_PRESS,
            )
        }

        /** Android publishes no warning constant, so the caveat takes the same
         * REJECT the failure does: it is the nearest documented meaning, and
         * inventing a waveform for it is what the platform's guidance rules out. */
        Function("warning") {
            perform(
                if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT
                else HapticFeedbackConstants.LONG_PRESS,
            )
        }

        /** The gesture threshold pair is API 34. */
        Function("thresholdActivate") {
            perform(
                if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.GESTURE_THRESHOLD_ACTIVATE
                else HapticFeedbackConstants.VIRTUAL_KEY,
            )
        }

        /** Backing off the threshold should read softer than crossing it, so the
         * pre-34 stand-in is CLOCK_TICK rather than VIRTUAL_KEY. */
        Function("thresholdDeactivate") {
            perform(
                if (Build.VERSION.SDK_INT >= 34)
                    HapticFeedbackConstants.GESTURE_THRESHOLD_DEACTIVATE
                else HapticFeedbackConstants.CLOCK_TICK,
            )
        }

        /** SEGMENT_TICK is API 34; CLOCK_TICK is the older discrete-step tick. */
        Function("selection") {
            perform(
                if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.SEGMENT_TICK
                else HapticFeedbackConstants.CLOCK_TICK,
            )
        }

        /** CONTEXT_CLICK is API 23, so it needs no fallback. */
        Function("contextClick") {
            perform(HapticFeedbackConstants.CONTEXT_CLICK)
        }

        /** iOS warms its Taptic Engine ahead of a gesture. Android's constants
         * play through a per-device effect the platform already has loaded, so
         * there is no latency to hide and nothing to do. */
        Function("prepare") {}
    }

    /** View feedback has to be asked for on the UI thread. A haptic with no
     * window to play through is a no-op rather than a crash: the app is in the
     * background, which is the one case where nobody is holding the phone. */
    private fun perform(constant: Int) {
        val activity = appContext.currentActivity ?: return
        activity.runOnUiThread { activity.window.decorView.performHapticFeedback(constant) }
    }
}
