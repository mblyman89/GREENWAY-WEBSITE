import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // GreenwayBridgeViewController, NOT Capacitor's stock
        // CAPBridgeViewController. It is a subclass that adds exactly one
        // thing: it registers our app-local StarPrinterPlugin with the bridge.
        // Capacitor cannot find that plugin on its own -- it only registers the
        // class names listed in capacitor.config.json's packageClassList, and
        // the CLI only ever puts INSTALLED NPM PLUGIN PACKAGES in that list.
        // Swap this back to CAPBridgeViewController and the receipt printer
        // silently disappears from the register. See the header comment in
        // GreenwayBridgeViewController.swift for the source references.
        window?.rootViewController = GreenwayBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
