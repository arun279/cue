Pod::Spec.new do |s|
  s.name           = 'CueNative'
  s.version        = '1.0.0'
  s.summary        = "Cue's native seams"
  s.description    = 'The seven-verb haptic vocabulary and the Capacitor preference reader the first-launch migration needs.'
  s.author         = 'Cue'
  s.homepage       = 'https://github.com/arun279/cue'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
