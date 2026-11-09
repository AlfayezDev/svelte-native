Pod::Spec.new do |s|
  s.name         = "SvelteScreensIOS"
  s.version      = "0.1.0"
  s.summary      = "UIKit stack, header, sheet and tabs for Svelte Native on React Native's Fabric mounting."
  s.description  = "Fabric components over UINavigationController, UINavigationItem, UISheetPresentationController and UITabBarController, configured from the navigation nativeID of @example/svelte-native."
  s.homepage     = "https://example.io"
  s.license      = { :type => "UNLICENSED" }
  s.author       = "Example"
  s.platforms    = { :ios => "16.4" }
  s.source       = { :path => "." }
  s.source_files = "**/*.{h,m,mm,cpp}"
  # C++ headers stay out of the umbrella header: nothing here is imported from Swift.
  s.project_header_files = "**/*.h"
  s.requires_arc = true
  s.pod_target_xcconfig = { "DEFINES_MODULE" => "NO" }

  # React-Core, React-RCTFabric, React-Fabric, folly and the C++ language level for a Fabric component.
  install_modules_dependencies(s)
end
