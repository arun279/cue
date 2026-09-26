import ExpoModulesCore
import UIKit

/// Cue's haptic vocabulary on iOS.
///
/// The app names interactions; this picks the documented UIKit generator for
/// each, per the Human Interface Guidelines' "Playing haptics": notification
/// feedback reports the outcome of a task, impact feedback is the physical
/// metaphor for something snapping into place, and selection feedback marks
/// movement through a series of discrete values.
///
/// Generators are built once and kept warm, which is the reason this is a local
/// module rather than `expo-haptics`: that package exposes no `prepare()`, and a
/// generator built at the instant of the event fires late enough to read as
/// belonging to some other action.
public class CueHapticsModule: Module {
    private let notification = UINotificationFeedbackGenerator()
    private let activate = UIImpactFeedbackGenerator(style: .medium)
    private let deactivate = UIImpactFeedbackGenerator(style: .light)
    private let selectionGenerator = UISelectionFeedbackGenerator()
    private lazy var generators: [UIFeedbackGenerator] = [
        notification, activate, deactivate, selectionGenerator,
    ]

    public func definition() -> ModuleDefinition {
        Name("CueHaptics")

        Function("success") {
            self.fire(self.notification) { $0.notificationOccurred(.success) }
        }

        Function("failure") {
            self.fire(self.notification) { $0.notificationOccurred(.error) }
        }

        // Apple: Warning "indicates that a task or action has produced a
        // warning of some kind", which is a completed action with a caveat
        // rather than a failure.
        Function("warning") {
            self.fire(self.notification) { $0.notificationOccurred(.warning) }
        }

        Function("thresholdActivate") {
            self.fire(self.activate) { $0.impactOccurred() }
        }

        Function("thresholdDeactivate") {
            self.fire(self.deactivate) { $0.impactOccurred() }
        }

        Function("selection") {
            self.fire(self.selectionGenerator) { $0.selectionChanged() }
        }

        // iOS has no context-click pattern of its own; Apple's own long-press
        // sample fires selection feedback, so a menu opening is one of these.
        Function("contextClick") {
            self.fire(self.selectionGenerator) { $0.selectionChanged() }
        }

        // Warm all four: a gesture that ticks at its threshold is the one that
        // ends in a mark, so the notification generator needs the head start too.
        Function("prepare") {
            DispatchQueue.main.async {
                for generator in self.generators { generator.prepare() }
            }
        }
    }

    /// Re-prepare the generator that just fired: the engine idles again within a
    /// few seconds, and a threshold pair or a run of marks usually wants a
    /// second tap right after the first.
    ///
    /// Dispatched from a synchronous `Function` rather than declared as an
    /// `AsyncFunction`: UIKit feedback has to be asked for on the main thread,
    /// and a haptic is fire and forget, so the caller should not be handed a
    /// promise it would only ever discard.
    private func fire<Generator: UIFeedbackGenerator>(
        _ generator: Generator,
        _ play: @escaping (Generator) -> Void
    ) {
        DispatchQueue.main.async {
            play(generator)
            generator.prepare()
        }
    }
}
