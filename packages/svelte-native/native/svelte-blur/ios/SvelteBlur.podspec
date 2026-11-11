Pod::Spec.new do |s|
  s.name           = 'SvelteBlur'
  s.version        = '0.1.0'
  s.summary        = 'The BlurView of Svelte Native, a UIVisualEffectView with an intensity, on iOS'
  s.description    = 'The native view behind packages/svelte-native\'s BlurView: a UIVisualEffectView under the view\'s children, its blur taken from a paused UIViewPropertyAnimator so that the intensity (0 to 100) is a fraction of the effect. It needs no expo-blur.'
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
