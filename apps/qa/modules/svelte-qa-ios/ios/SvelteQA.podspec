Pod::Spec.new do |s|
  s.name           = 'SvelteQA'
  s.version        = '0.1.0'
  s.summary        = 'QA inspection of the Svelte Native lab on iOS'
  s.description    = 'The lab app asks it for a screenshot of its own window, a dump of the accessibility tree VoiceOver walks and the launch-to-first-frame times; qa/ on the harness side reads what it writes. Refuses to run outside the QA bundle.'
  s.license        = 'MIT'
  s.author         = 'Rasheed'
  s.homepage       = 'https://github.com/rasheed'
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
