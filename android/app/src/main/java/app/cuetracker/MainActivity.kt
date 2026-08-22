package app.cuetracker

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    // Plugins that live in this target rather than in a published package have
    // to be handed to the bridge builder before BridgeActivity builds the bridge.
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(CueHapticsPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
