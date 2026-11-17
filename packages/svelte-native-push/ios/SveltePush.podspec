Pod::Spec.new do |s|
  s.name           = 'SveltePush'
  s.version        = '0.1.0'
  s.summary        = 'The native code of push notifications for Svelte Native on iOS'
  s.description    = 'One pod for the native half of @alfayez/svelte-native/push on iOS: the Expo module (permission, the APNs device token, showing, taps) and the app delegate subscriber that receives the registration and the silent pushes.'
  s.license        = 'MIT'
  s.author         = 'Example'
  s.homepage       = 'https://github.com/example'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift}'
  s.requires_arc = true
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
