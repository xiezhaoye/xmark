import Foundation
import Tauri
import UIKit
import WebKit

struct ShareFileArgs: Decodable {
  let name: String
  let base64: String
  let mimeType: String?
}

class SharePlugin: Plugin {
  private var presenting = false
  private var tempDirectory: URL?
  private weak var webView: WKWebView?

  public override func load(webview: WKWebView) {
    webView = webview
  }

  @objc public func shareFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareFileArgs.self)
    DispatchQueue.main.async {
      self.beginShare(args, invoke: invoke)
    }
  }

  // All presentation state belongs to the main thread. Mark the operation
  // busy before writing a temporary file or accepting another request.
  private func beginShare(_ args: ShareFileArgs, invoke: Invoke) {
    guard !presenting else {
      invoke.reject("share already in progress")
      return
    }
    guard !args.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      args.name != ".", args.name != "..", args.name.utf8.count <= 255,
      !args.name.contains("/"), !args.name.contains("\\"),
      args.name.rangeOfCharacter(from: .controlCharacters) == nil else {
      invoke.reject("invalid filename")
      return
    }
    guard let data = Data(base64Encoded: args.base64), data.count <= 30 * 1024 * 1024 else {
      invoke.reject("invalid file data")
      return
    }
    guard let window = webView?.window,
      window.windowScene?.activationState == .foregroundActive,
      let presenter = visibleViewController(window.rootViewController),
      presenter.view.window != nil, !presenter.isBeingDismissed else {
      invoke.reject("no active view controller to present from")
      return
    }
    presenting = true
    let manager = FileManager.default
    let directory = manager.temporaryDirectory.appendingPathComponent("xmark-share-\(UUID().uuidString)", isDirectory: true)
    tempDirectory = directory
    do {
      try manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      let file = directory.appendingPathComponent(args.name)
      try data.write(to: file, options: .atomic)
      try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
      let activity = UIActivityViewController(activityItems: [file], applicationActivities: nil)
      if let popover = activity.popoverPresentationController {
        popover.sourceView = presenter.view
        popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
        popover.permittedArrowDirections = []
      }
      activity.completionWithItemsHandler = { _, completed, _, error in
        self.cleanup()
        if error != nil {
          invoke.reject("file sharing failed")
        } else {
          invoke.resolve(["completed": completed])
        }
      }
      presenter.present(activity, animated: true)
    } catch {
      cleanup()
      invoke.reject("failed to write temporary file")
    }
  }

  private func visibleViewController(_ root: UIViewController?) -> UIViewController? {
    if let presented = root?.presentedViewController {
      return visibleViewController(presented)
    }
    if let navigation = root as? UINavigationController {
      return visibleViewController(navigation.visibleViewController)
    }
    if let tabs = root as? UITabBarController {
      return visibleViewController(tabs.selectedViewController)
    }
    return root
  }

  private func cleanup() {
    presenting = false
    if let directory = tempDirectory {
      try? FileManager.default.removeItem(at: directory)
    }
    tempDirectory = nil
  }
}

@_cdecl("init_plugin_xmark_share")
func initPlugin() -> Plugin {
  SharePlugin()
}
