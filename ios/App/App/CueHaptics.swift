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
        CAPPluginMethod(name: "failure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "warning", returnType: CAPPluginReturnPromise),
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
    private lazy var generators: [UIFeedbackGenerator] = [
        notification, activate, deactivate, selectionGenerator
    ]

    @objc func success(_ call: CAPPluginCall) {
        fire(call, notification) { $0.notificationOccurred(.success) }
    }

    @objc func failure(_ call: CAPPluginCall) {
        fire(call, notification) { $0.notificationOccurred(.error) }
    }

    /// Apple: Warning "indicates that a task or action has produced a warning of
    /// some kind", which is a completed action with a caveat rather than a failure.
    @objc func warning(_ call: CAPPluginCall) {
        fire(call, notification) { $0.notificationOccurred(.warning) }
    }

    @objc func thresholdActivate(_ call: CAPPluginCall) {
        fire(call, activate) { $0.impactOccurred() }
    }

    @objc func thresholdDeactivate(_ call: CAPPluginCall) {
        fire(call, deactivate) { $0.impactOccurred() }
    }

    @objc func selection(_ call: CAPPluginCall) {
        fire(call, selectionGenerator) { $0.selectionChanged() }
    }

    /// iOS has no context-click pattern of its own; Apple's own long-press
    /// sample fires selection feedback, so a menu opening is one of these.
    @objc func contextClick(_ call: CAPPluginCall) {
        fire(call, selectionGenerator) { $0.selectionChanged() }
    }

    /// Warm all four: a gesture that ticks at its threshold is the one that ends
    /// in a mark, so the notification generator needs the head start too.
    @objc func prepare(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.generators.forEach { $0.prepare() }
            call.resolve()
        }
    }

    /// Re-prepare the generator that just fired: the engine idles again within a
    /// few seconds, and a threshold pair or a run of marks usually wants a
    /// second tap right after the first.
    private func fire<Generator: UIFeedbackGenerator>(
        _ call: CAPPluginCall,
        _ generator: Generator,
        _ play: @escaping (Generator) -> Void
    ) {
        DispatchQueue.main.async {
            play(generator)
            generator.prepare()
            call.resolve()
        }
    }
}
