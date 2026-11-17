require 'json'

# The features an app turned on are compile conditions of this pod, so that an app that did not has no code of them in its binary (App Store Connect refuses a binary that uses an API without its usage text:
# for location, CoreLocation without NSLocationWhenInUseUsageDescription). The config plugin writes `"<key>": "true"` into Expo's ios/Podfile.properties.json for a capability that is on for iOS and
# takes the key away when it is off (`locationPodfileProperty` in src/capabilities.ts); each Swift file of such a feature is `#if <condition> ... #endif`, and a stub module stands in for it
# (ios/location/SvelteLocationModule.swift). The file is read when the pod is installed, so `pod install` (a prebuild does it) is what changes the build.
podfile_properties = begin
  JSON.parse(File.read(File.join(Pod::Config.instance.installation_root, 'Podfile.properties.json')))
rescue StandardError
  {}
end
compile_conditions = {
  'svelteNative.location' => 'SVELTE_LOCATION',
}.select { |key, _| podfile_properties[key] == 'true' }.values

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
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => (['$(inherited)'] + compile_conditions).join(' ')
  }

  # React-RCTFabric, React-Fabric, folly and the C++ language level for the Fabric components (merged into the settings above).
  install_modules_dependencies(s)
end
