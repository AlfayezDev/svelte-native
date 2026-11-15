Pod::Spec.new do |s|
  s.name           = 'SvelteCore'
  s.version        = '0.1.0'
  s.summary        = 'The native code of Svelte Native on iOS'
  s.description    = 'One pod for the native half of packages/svelte-native on iOS: the Expo modules (fetch and Blob on URLSession, the clipboard, the safe-area insets, navigation restore, the update store, the blur view, the capture sweep) and the Fabric components of the UIKit stack, header, sheet and tabs.'
  s.license        = 'MIT'
  s.author         = 'Rasheed'
  s.homepage       = 'https://github.com/rasheed'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'React-Core'

  s.source_files = '**/*.{h,m,mm,cpp,swift}'
  # The screens' Objective-C++ and C++ headers stay out of the umbrella header: nothing of them is imported from Swift, and a C++ header
  # cannot be part of a Clang module that Swift imports.
  s.project_header_files = 'screens/**/*.h'
  s.requires_arc = true
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # React-RCTFabric, React-Fabric, folly and the C++ language level for the Fabric components (merged into the settings above).
  install_modules_dependencies(s)
end
