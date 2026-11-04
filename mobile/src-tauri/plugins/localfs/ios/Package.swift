// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-xmark-localfs",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "tauri-plugin-xmark-localfs",
      type: .static,
      targets: ["tauri-plugin-xmark-localfs"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-xmark-localfs",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
