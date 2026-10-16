Pod::Spec.new do |s|
  s.name           = 'AutocutExport'
  s.version        = '1.0.0'
  s.summary        = 'Exports an Autocut edit on the phone.'
  s.description    = 'Renders the edit (clips, speed, sound, captions, text, music, zoom, overlays) with AVFoundation and the hardware video encoder.'
  s.license        = 'MIT'
  s.author         = 'Autocut'
  s.homepage       = 'https://github.com/expo/expo'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
