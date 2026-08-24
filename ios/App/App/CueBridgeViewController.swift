import Capacitor

/// The app's bridge controller: it hands the bridge the plugins that live in
/// this target rather than in a published package, and turns on the left-edge
/// swipe back, which Capacitor exposes no config key for.
///
/// SceneDelegate is where this class is chosen and the storyboard is left as the
/// template ships it: "If you use a custom CAPBridgeViewController subclass,
/// instantiate it here instead of setting it in the storyboard."
/// https://capacitorjs.com/docs/updating/8-5
class CueBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CueHapticsPlugin())
    }

    /// The router runs on browser history, so WebKit's own back gesture pops it
    /// with no JS shim in between.
    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
    }
}
