import Capacitor
import UIKit

/// The app's view controller, only to register helm's own plugin (the UDP socket) with Capacitor.
class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HelmUdpPlugin())
    }
}
