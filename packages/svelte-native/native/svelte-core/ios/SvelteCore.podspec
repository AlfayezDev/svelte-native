Pod::Spec.new do |s|
  s.name           = 'SvelteCore'
  s.version        = '0.1.0'
  s.summary        = 'The native half of Svelte Native\'s own fetch and Blob, on URLSession (iOS)'
  s.description    = 'The Expo module SvelteFetch behind packages/svelte-native\'s fetch and Blob: the request on the wire, the response bytes and the bytes of every Blob stay native, and reach JavaScript only as ArrayBuffers that native code allocated. It needs no expo/fetch and no expo-blob.'
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
