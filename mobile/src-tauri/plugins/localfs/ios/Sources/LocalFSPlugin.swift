import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

/// One folder the user picked in the document picker.
///
/// iOS gives us a security-scoped URL, not a plain path: the app may read it
/// only while it holds an active scope, and only the bookmark survives a
/// relaunch. Both live here — the picker, the bookmark store, and resolving a
/// stored bookmark back into a live scope — because they are the same concern.
/// Reading the bytes stays in Rust (the scope belongs to the process, so
/// `std::fs` sees it too).
struct FolderPickArgs: Decodable {}

struct ForgetFolderArgs: Decodable {
  let path: String
}

class LocalFSPlugin: Plugin, UIDocumentPickerDelegate {
  /// Bookmark store: absolute path → base64 bookmark data.
  private static let bookmarksKey = "xmark.localfs.bookmarks"

  private var pending: Invoke?
  private weak var webView: WKWebView?

  public override func load(webview: WKWebView) {
    webView = webview
  }

  // MARK: - Commands

  @objc public func pickFolder(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      self.present(invoke)
    }
  }

  /// Re-activates the scope of every remembered folder. Called once at launch:
  /// a bookmark that no longer resolves (folder deleted, moved, or the grant
  /// revoked) comes back with `ok: false` so the app can say so instead of
  /// showing an empty folder.
  @objc public func restoreFolders(_ invoke: Invoke) throws {
    let stored = Self.storedBookmarks()
    var folders: [[String: Any]] = []
    for (path, base64) in stored {
      guard let data = Data(base64Encoded: base64) else { continue }
      var stale = false
      guard let url = try? URL(resolvingBookmarkData: data, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale),
        url.startAccessingSecurityScopedResource()
      else {
        folders.append(["path": path, "name": (path as NSString).lastPathComponent, "ok": false])
        continue
      }
      let readable = FileManager.default.isReadableFile(atPath: url.path)
      folders.append(["path": url.path, "name": url.lastPathComponent, "ok": readable])
    }
    invoke.resolve(["folders": folders])
  }

  @objc public func forgetFolder(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ForgetFolderArgs.self)
    var stored = Self.storedBookmarks()
    stored[args.path] = nil
    UserDefaults.standard.set(stored, forKey: Self.bookmarksKey)
    invoke.resolve()
  }

  // MARK: - Picker

  private func present(_ invoke: Invoke) {
    guard pending == nil else {
      invoke.reject("a folder picker is already open")
      return
    }
    guard let window = webView?.window,
      window.windowScene?.activationState == .foregroundActive,
      let presenter = visibleViewController(window.rootViewController),
      presenter.view.window != nil, !presenter.isBeingDismissed
    else {
      invoke.reject("no active view controller to present from")
      return
    }
    pending = invoke
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder], asCopy: false)
    picker.delegate = self
    picker.allowsMultipleSelection = false
    presenter.present(picker, animated: true)
  }

  public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let invoke = pending else { return }
    pending = nil
    guard let url = urls.first else {
      invoke.reject("cancelled")
      return
    }
    guard url.startAccessingSecurityScopedResource() else {
      invoke.reject("cannot access the folder")
      return
    }
    do {
      // `.minimalBookmark` is the iOS spelling: the scope travels with the
      // bookmark, and `.withoutUI` resolves it without prompting again.
      let data = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
      var stored = Self.storedBookmarks()
      stored[url.path] = data.base64EncodedString()
      UserDefaults.standard.set(stored, forKey: Self.bookmarksKey)
      invoke.resolve(["path": url.path, "name": url.lastPathComponent])
    } catch {
      invoke.reject("cannot bookmark the folder: \(error.localizedDescription)")
    }
  }

  public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pending?.reject("cancelled")
    pending = nil
  }

  // MARK: - Helpers

  private static func storedBookmarks() -> [String: String] {
    (UserDefaults.standard.dictionary(forKey: bookmarksKey) as? [String: String]) ?? [:]
  }

  /// The topmost presented controller, which is what can present the picker.
  private func visibleViewController(_ root: UIViewController?) -> UIViewController? {
    var current = root
    while let presented = current?.presentedViewController {
      current = presented
    }
    return current
  }
}

/// The symbol the Rust side binds to (`ios_plugin_binding!`). Without it the
/// app links against nothing and every local-folder command fails at startup.
@_cdecl("init_plugin_xmark_localfs")
func initPlugin() -> Plugin {
  LocalFSPlugin()
}
