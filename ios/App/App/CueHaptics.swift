import Capacitor
import UIKit

/// Cue's own haptics bridge, registered from `CueBridgeViewController`.
///
/// The web layer names interactions; this picks the documented UIKit generator
/// for each, per the Human Interface Guidelines' "Playing haptics": notification
/// feedback reports the outcome of a task, impact feedback is the physical
/// metaphor for something snapping into place, and selection feedback marks
/// movement through a series of discrete values.
///
/// Generators are built once and kept warm. `prepare()` is what keeps a
/// threshold tick on time: a generator built at the instant of the event fires
/// late enough to read as belonging to some other action.
@objc(CueHapticsPlugin)
public class CueHapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CueHapticsPlugin"
    public let jsName = "CueHaptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "success", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "thresholdActivate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "thresholdDeactivate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "selection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "contextClick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise)
    ]

    private let notification = UINotificationFeedbackGenerator()
    private let activate = UIImpactFeedbackGenerator(style: .medium)
    private let deactivate = UIImpactFeedbackGenerator(style: .light)
    private let selectionGenerator = UISelectionFeedbackGenerator()

    @objc func success(_ call: CAPPluginCall) {
        fire(call) { self.notification.notificationOccurred(.success) }
    }

    @objc func thresholdActivate(_ call: CAPPluginCall) {
        fire(call) { self.activate.impactOccurred() }
    }

    @objc func thresholdDeactivate(_ call: CAPPluginCall) {
        fire(call) { self.deactivate.impactOccurred() }
    }

    @objc func selection(_ call: CAPPluginCall) {
        fire(call) { self.selectionGenerator.selectionChanged() }
    }

    /// iOS has no context-click pattern of its own; Apple's own long-press
    /// sample fires selection feedback, so a menu opening is one of these.
    @objc func contextClick(_ call: CAPPluginCall) {
        fire(call) { self.selectionGenerator.selectionChanged() }
    }

    @objc func prepare(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.activate.prepare()
            self.deactivate.prepare()
            call.resolve()
        }
    }

    /// Re-prepare after firing: the engine idles again within a few seconds, and
    /// a threshold pair or a run of marks usually wants a second tap right after
    /// the first.
    private func fire(_ call: CAPPluginCall, _ play: @escaping () -> Void) {
        DispatchQueue.main.async {
            play()
            self.activate.prepare()
            self.deactivate.prepare()
            call.resolve()
        }
    }
}
