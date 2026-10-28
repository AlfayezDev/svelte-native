# Generates GesturesUITests.xcodeproj next to this file: one UI testing bundle with no target application (the test starts the lab app by
# its bundle id), and a scheme that tests it. `native-qa gestures --platform ios` runs it on the Mac (the `xcodeproj` gem comes with
# CocoaPods, which the Mac already has for the app's pods). The development team comes from DEVELOPMENT_TEAM.
require 'fileutils'
require 'xcodeproj'

dir = File.expand_path(__dir__)
path = File.join(dir, 'GesturesUITests.xcodeproj')
FileUtils.rm_rf(path)

project = Xcodeproj::Project.new(path)
target = project.new_target(:ui_test_bundle, 'GesturesUITests', :ios, '16.0')
group = project.main_group.new_group('GesturesUITests', 'GesturesUITests')
target.add_file_references([group.new_file('GesturesUITests.swift')])

target.build_configurations.each do |config|
  settings = config.build_settings
  settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'io.rasheed.svelteqa.gesturesuitests'
  settings['PRODUCT_NAME'] = '$(TARGET_NAME)'
  settings['SWIFT_VERSION'] = '5.0'
  settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  settings['TARGETED_DEVICE_FAMILY'] = '1'
  settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'
  settings['CODE_SIGN_STYLE'] = 'Automatic'
  settings['DEVELOPMENT_TEAM'] = ENV['DEVELOPMENT_TEAM'] if ENV['DEVELOPMENT_TEAM']
end

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target, false)
scheme.add_test_target(target)
scheme.save_as(path, 'GesturesUITests', true)
project.save
puts "wrote #{path}"
