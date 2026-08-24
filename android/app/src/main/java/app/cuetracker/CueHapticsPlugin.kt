package app.cuetracker

import android.os.Build
import android.view.HapticFeedbackConstants
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Cue's own haptics bridge, registered from [MainActivity].
 *
 * The web layer names interactions; this answers with the action-oriented
 * [HapticFeedbackConstants] for each, played through the bridge's WebView. That
 * path is the one Android's haptics guidance recommends first: the OEM tunes
 * each constant for the actuator in that phone, it honours the system Touch
 * feedback setting by contract, and it needs no VIBRATE permission. Raw
 * `Vibrator` waveforms are what the same guidance tells you not to use for
 * touch feedback.
 *
 * Several constants arrived after this app's minSdk of 24, so each one below
 * names the release it landed in and the older effect that stands in for it.
 */
@CapacitorPlugin(name = "CueHaptics")
class CueHapticsPlugin : Plugin() {
    /** CONFIRM is API 30. Below it, VIRTUAL_KEY is the platform's baseline
     * "that registered" tap. */
    @PluginMethod
    fun success(call: PluginCall) = perform(
        call,
        if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM
        else HapticFeedbackConstants.VIRTUAL_KEY,
    )

    /** The gesture threshold pair is API 34. */
    @PluginMethod
    fun thresholdActivate(call: PluginCall) = perform(
        call,
        if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.GESTURE_THRESHOLD_ACTIVATE
        else HapticFeedbackConstants.VIRTUAL_KEY,
    )

    /** Backing off the threshold should read softer than crossing it, so the
     * pre-34 stand-in is CLOCK_TICK rather than VIRTUAL_KEY. */
    @PluginMethod
    fun thresholdDeactivate(call: PluginCall) = perform(
        call,
        if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.GESTURE_THRESHOLD_DEACTIVATE
        else HapticFeedbackConstants.CLOCK_TICK,
    )

    /** SEGMENT_TICK is API 34; CLOCK_TICK is the older discrete-step tick. */
    @PluginMethod
    fun selection(call: PluginCall) = perform(
        call,
        if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.SEGMENT_TICK
        else HapticFeedbackConstants.CLOCK_TICK,
    )

    /** CONTEXT_CLICK is API 23, so it needs no fallback at minSdk 24. */
    @PluginMethod
    fun contextClick(call: PluginCall) = perform(call, HapticFeedbackConstants.CONTEXT_CLICK)

    /** iOS warms its Taptic Engine ahead of a gesture. Android's constants play
     * through a per-device effect the platform already has loaded, so there is
     * no latency to hide and nothing to do. */
    @PluginMethod
    fun prepare(call: PluginCall) = call.resolve()

    /** Plugin methods run on Capacitor's own handler thread; View feedback has
     * to be asked for on the UI thread. */
    private fun perform(call: PluginCall, constant: Int) {
        bridge.executeOnMainThread {
            bridge.webView.performHapticFeedback(constant)
            call.resolve()
        }
    }
}
