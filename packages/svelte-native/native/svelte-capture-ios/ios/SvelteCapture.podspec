Pod::Spec.new do |s|
  s.name           = 'SvelteCapture'
  s.version        = '0.1.0'
  s.summary        = 'Clears the tmpfile captures of react-native-view-shot that an earlier process of the Svelte Native app left behind'
  s.description    = 'React Native deletes tmp/ReactNative only when a process makes its first temporary file, so the captures of a process that ended stay on the phone until the next capture. This module deletes them when the process starts, as the Android engine does for its cache directory.'
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
