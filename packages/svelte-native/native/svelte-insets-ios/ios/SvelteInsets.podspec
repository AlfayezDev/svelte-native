Pod::Spec.new do |s|
  s.name           = 'SvelteInsets'
  s.version        = '0.1.0'
  s.summary        = 'Safe area and keyboard insets for the Svelte Native host on iOS'
  s.description    = 'Reports the window\'s safe area insets and the keyboard\'s overlap to packages/svelte-native (SafeAreaView, KeyboardAvoidingView, Screen) in the shape of the Android engine\'s insets event.'
  s.license        = 'MIT'
  s.author         = 'Example'
  s.homepage       = 'https://github.com/example'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
