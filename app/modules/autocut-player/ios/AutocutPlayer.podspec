Pod::Spec.new do |s|
  s.name           = 'AutocutPlayer'
  s.version        = '1.0.0'
  s.summary        = 'Plays an Autocut edit as one continuous video.'
  s.description    = 'Stitches the clips of an edit into an AVMutableComposition so the editor plays straight through every cut.'
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
