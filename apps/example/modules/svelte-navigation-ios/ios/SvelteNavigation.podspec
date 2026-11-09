Pod::Spec.new do |s|
  s.name           = 'SvelteNavigation'
  s.version        = '0.1.0'
  s.summary        = 'The root router\'s navigation state across the death of the process, on iOS'
  s.description    = 'Keeps the JSON the Svelte Native root router writes and gives it back to packages/svelte-native once, when the system ended the process while the app was in the background (the Android MainActivity\'s saved instance state, SPEC.md "Navigation state across recreation and process death").'
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
