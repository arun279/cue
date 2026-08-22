import Capacitor

/// The app's bridge controller. Its one job is to hand the bridge the plugins
/// that live in this target rather than in a published package.
///
/// Capacitor documents subclassing through the storyboard's custom class, and
/// under 8.5 that no longer reaches anything: SceneDelegate builds its own
/// window with its own CAPBridgeViewController and that is the one the app
/// runs. Verified by pointing the storyboard at this class and watching
/// `capacitorDidLoad` never fire. So SceneDelegate is where the class is
/// chosen, and the storyboard is left as the template ships it.
class CueBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CueHapticsPlugin())
    }
}
