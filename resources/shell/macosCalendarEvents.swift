import AppKit
import EventKit
import Foundation

let entryDelimiter = "\u{001e}"
let fieldDelimiter = "\u{001f}"

func hexFrom(_ color: NSColor?) -> String {
    guard let rgb = color?.usingColorSpace(.sRGB) else {
        return "#FFCC00"
    }

    let red = Int(round(rgb.redComponent * 255))
    let green = Int(round(rgb.greenComponent * 255))
    let blue = Int(round(rgb.blueComponent * 255))
    return String(format: "#%02X%02X%02X", red, green, blue)
}

func escapeField(_ value: String) -> String {
    value
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: fieldDelimiter, with: "\\u001f")
        .replacingOccurrences(of: entryDelimiter, with: "\\u001e")
        .replacingOccurrences(of: "\n", with: " ")
        .replacingOccurrences(of: "\r", with: " ")
}

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)
var granted = false

if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { accessGranted, _ in
        granted = accessGranted
        semaphore.signal()
    }
} else {
    store.requestAccess(to: .event) { accessGranted, _ in
        granted = accessGranted
        semaphore.signal()
    }
}

semaphore.wait()

if !granted {
    print("DENIED")
    exit(2)
}

let calendar = Calendar.current
let startOfDay = calendar.startOfDay(for: Date())
guard let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay) else {
    print("ERROR")
    exit(1)
}

let predicate = store.predicateForEvents(withStart: startOfDay, end: endOfDay, calendars: nil)
let events = store.events(matching: predicate).sorted { left, right in
    if left.startDate == right.startDate {
        return (left.title ?? "") < (right.title ?? "")
    }

    return left.startDate < right.startDate
}

var output = ""

for event in events.prefix(3) {
    let identifier = event.eventIdentifier ?? ""
    let title = event.title ?? "(Sem título)"
    let startMs = Int(event.startDate.timeIntervalSince1970 * 1000)
    let endMs = Int(event.endDate.timeIntervalSince1970 * 1000)
    let location = event.location ?? ""
    let calendarName = event.calendar.title
    let colorHex = hexFrom(event.calendar.color)
    let allDay = event.isAllDay ? "1" : "0"
    let fields = [
        escapeField(identifier),
        escapeField(title),
        String(startMs),
        String(endMs),
        escapeField(location),
        escapeField(calendarName),
        colorHex,
        allDay,
    ]
    output += fields.joined(separator: fieldDelimiter) + entryDelimiter
}

print(output)
