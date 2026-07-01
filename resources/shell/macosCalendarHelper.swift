import AppKit
import EventKit
import Foundation

let fieldDelimiter = "\u{001f}"
let entryDelimiter = "\u{001e}"

func escapeField(_ value: String) -> String {
    value
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: fieldDelimiter, with: "\\u001f")
        .replacingOccurrences(of: entryDelimiter, with: "\\u001e")
        .replacingOccurrences(of: "\r\n", with: "\\n")
        .replacingOccurrences(of: "\n", with: "\\n")
        .replacingOccurrences(of: "\r", with: "\\r")
}

func hexFrom(_ color: NSColor?) -> String {
    guard let rgb = color?.usingColorSpace(.sRGB) else {
        return "#FFCC00"
    }

    let red = Int(round(rgb.redComponent * 255))
    let green = Int(round(rgb.greenComponent * 255))
    let blue = Int(round(rgb.blueComponent * 255))
    return String(format: "#%02X%02X%02X", red, green, blue)
}

func hasCalendarReadAccess() -> Bool {
    let status = EKEventStore.authorizationStatus(for: .event)

    if #available(macOS 14.0, *) {
        return status == .fullAccess || status == .authorized
    }

    return status == .authorized
}

func waitForPermission(store: EKEventStore, completion: @escaping (Bool) -> Void) {
    if hasCalendarReadAccess() {
        completion(true)
        return
    }

    let status = EKEventStore.authorizationStatus(for: .event)

    if #available(macOS 14.0, *) {
        if status == .denied || status == .restricted || status == .writeOnly {
            completion(false)
            return
        }
    } else if status == .denied || status == .restricted {
        completion(false)
        return
    }

    NSApplication.shared.setActivationPolicy(.accessory)
    NSApplication.shared.activate(ignoringOtherApps: true)

    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { _, _ in
            completion(hasCalendarReadAccess())
        }
    } else {
        store.requestAccess(to: .event) { _, _ in
            completion(hasCalendarReadAccess())
        }
    }
}

func fetchEvents(store: EKEventStore) -> String {
    let calendar = Calendar.current
    let startOfDay = calendar.startOfDay(for: Date())
    guard let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay) else {
        return "ERROR"
    }

    let predicate = store.predicateForEvents(withStart: startOfDay, end: endOfDay, calendars: nil)
    let events = store.events(matching: predicate).sorted { left, right in
        if left.startDate == right.startDate {
            return (left.title ?? "") < (right.title ?? "")
        }

        return left.startDate < right.startDate
    }

    var output = ""

    for event in events.prefix(12) {
        let identifier = escapeField(event.eventIdentifier ?? "")
        let title = escapeField(event.title ?? "(Sem título)")
        let startMs = Int(event.startDate.timeIntervalSince1970 * 1000)
        let endMs = Int(event.endDate.timeIntervalSince1970 * 1000)
        let location = escapeField(event.location ?? "")
        let calendarName = escapeField(event.calendar.title)
        let colorHex = hexFrom(event.calendar.color)
        let allDay = event.isAllDay ? "1" : "0"
        let notes = escapeField(event.notes ?? "")
        let url = escapeField(event.url?.absoluteString ?? "")
        let fields = [
            identifier,
            title,
            String(startMs),
            String(endMs),
            location,
            calendarName,
            colorHex,
            allDay,
            notes,
            url,
        ]
        output += fields.joined(separator: fieldDelimiter) + entryDelimiter
    }

    return output
}

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)
var output = "DENIED"
let outputPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""

_ = NSApplication.shared

waitForPermission(store: store) { granted in
    if granted {
        output = fetchEvents(store: store)
    }

    semaphore.signal()
}

while semaphore.wait(timeout: .now()) == .timedOut {
    RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
}

if !outputPath.isEmpty {
    try? output.write(toFile: outputPath, atomically: true, encoding: .utf8)
} else {
    print(output)
}

NSApplication.shared.terminate(nil)
