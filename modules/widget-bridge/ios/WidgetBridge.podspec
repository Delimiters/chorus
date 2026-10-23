Pod::Spec.new do |s|
  s.name           = 'WidgetBridge'
  s.version        = '1.0.0'
  s.summary        = 'Lets JavaScript talk to the home-screen widget and the Live Activity.'
  s.description    = <<~DESC
    A widget and a Live Activity run in their own process and cannot execute the
    app's JavaScript. The only thing the app and the widget share is the App
    Group container, and nothing in Expo can reach it — so this is the smallest
    possible native surface: write the snapshot, ask WidgetKit to redraw, drain
    the ticks made from the home screen, and start / update / end the Live
    Activity.
  DESC
  s.author         = 'Chorus'
  s.homepage       = 'https://github.com/Delimiters/chorus'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: 'https://github.com/Delimiters/chorus' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
