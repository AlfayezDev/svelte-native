Pod::Spec.new do |s|
  s.name           = 'SvelteUpdates'
  s.version        = '0.1.0'
  s.summary        = 'Update store and launcher for the Svelte Native host'
  s.description    = 'Keeps downloaded over-the-air updates on disk, launches the newest one and downloads new ones for packages/svelte-native/src/updates.'
  s.license        = 'MIT'
  s.author         = 'Rasheed'
  s.homepage       = 'https://github.com/rasheed'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'React-Core'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
