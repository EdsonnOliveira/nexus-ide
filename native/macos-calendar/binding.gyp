{
  "targets": [
    {
      "target_name": "macos_calendar",
      "sources": ["src/calendar.mm"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='mac'", {
          "libraries": [
            "-framework EventKit",
            "-framework AppKit",
            "-framework Foundation"
          ],
          "xcode_settings": {
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "OTHER_CFLAGS": ["-ObjC++", "-std=c++17"]
          }
        }]
      ]
    }
  ]
}
