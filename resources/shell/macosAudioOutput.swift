import CoreAudio
import Foundation

func readPropertyString(_ deviceID: AudioObjectID, selector: AudioObjectPropertySelector) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var cfString: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    let status = withUnsafeMutablePointer(to: &cfString) { pointer in
        AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, pointer)
    }

    guard status == noErr else {
        return nil
    }

    return cfString as String
}

func defaultOutputID() -> AudioDeviceID {
    var deviceID = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &size,
        &deviceID
    )
    return deviceID
}

func outputDevices() -> [AudioDeviceID] {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &size
    ) == noErr else {
        return []
    }

    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var ids = [AudioDeviceID](repeating: 0, count: count)
    guard AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &size,
        &ids
    ) == noErr else {
        return []
    }

    return ids.filter { id in
        var streamAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreams,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain
        )
        var streamSize: UInt32 = 0
        return AudioObjectGetPropertyDataSize(id, &streamAddress, 0, nil, &streamSize) == noErr && streamSize > 0
    }
}

let command = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "list"
let current = defaultOutputID()

if command == "list" {
    for id in outputDevices() {
        let name = readPropertyString(id, selector: kAudioDevicePropertyDeviceNameCFString) ?? "Unknown"
        let uid = readPropertyString(id, selector: kAudioDevicePropertyDeviceUID) ?? ""
        let active = id == current ? "1" : "0"
        print("\(uid)\t\(name)\t\(active)")
    }
} else if command == "set", CommandLine.arguments.count > 2 {
    let target = CommandLine.arguments[2]

    for id in outputDevices() {
        let name = readPropertyString(id, selector: kAudioDevicePropertyDeviceNameCFString) ?? ""
        let uid = readPropertyString(id, selector: kAudioDevicePropertyDeviceUID) ?? ""

        if name == target || uid == target {
            var deviceID = id
            var address = AudioObjectPropertyAddress(
                mSelector: kAudioHardwarePropertyDefaultOutputDevice,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            let size = UInt32(MemoryLayout<AudioDeviceID>.size)
            let status = AudioObjectSetPropertyData(
                AudioObjectID(kAudioObjectSystemObject),
                &address,
                0,
                nil,
                size,
                &deviceID
            )
            print(status == noErr ? "ok" : "error")
            exit(status == noErr ? 0 : 1)
        }
    }

    print("not_found")
    exit(1)
}
