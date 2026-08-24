import AppKit
import EventKit
import Foundation

let fieldDelimiter = "\u{001f}"
let entryDelimiter = "\u{001e}"

struct CalendarAccountPayload: Codable {
    let id: String
    let title: String
    let calendars: [CalendarListItemPayload]
}

struct CalendarListItemPayload: Codable {
    let id: String
    let title: String
    let colorHex: String
    let allowsEdit: Bool
    let sourceId: String
    let sourceTitle: String
}

struct CalendarAttendeePayload: Codable {
    let name: String
    let email: String
    let status: String
    let isOrganizer: Bool
    let isOptional: Bool
}

struct CalendarAlarmPayload: Codable {
    let relativeOffsetMinutes: Int
}

struct CalendarFullEventPayload: Codable {
    let id: String
    let title: String
    let startAt: Int64
    let endAt: Int64
    let location: String
    let calendarId: String
    let calendarName: String
    let colorHex: String
    let allDay: Bool
    let notes: String
    let url: String
    let status: String
    let hasRecurrence: Bool
    let recurrenceLabel: String
    let allowsEdit: Bool
    let alarms: [CalendarAlarmPayload]
    let attendees: [CalendarAttendeePayload]
}

struct CalendarCalendarsSnapshot: Codable {
    let accessGranted: Bool
    let accounts: [CalendarAccountPayload]
}

struct CalendarRangeEventsSnapshot: Codable {
    let accessGranted: Bool
    let available: Bool
    let events: [CalendarFullEventPayload]
}

struct CalendarMutationResult: Codable {
    let ok: Bool
    let event: CalendarFullEventPayload?
    let error: String?
}

struct CalendarCreateInput: Codable {
    let title: String
    let startAt: Int64
    let endAt: Int64
    let calendarId: String
    let allDay: Bool?
    let location: String?
    let notes: String?
    let url: String?
    let alertMinutes: Int?
    let recurrence: String?
}

struct CalendarUpdateInput: Codable {
    let id: String
    let title: String?
    let startAt: Int64?
    let endAt: Int64?
    let calendarId: String?
    let allDay: Bool?
    let location: String?
    let notes: String?
    let url: String?
    let alertMinutes: Int?
    let recurrence: String?
    let span: String?
}

struct CalendarDeleteInput: Codable {
    let id: String
    let span: String?
}

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

func waitForPermission(store: EKEventStore, prompt: Bool, completion: @escaping (Bool) -> Void) {
    if hasCalendarReadAccess() {
        completion(true)
        return
    }

    if !prompt {
        completion(false)
        return
    }

    let status = EKEventStore.authorizationStatus(for: .event)

    if #available(macOS 14.0, *) {
        if status == .denied || status == .restricted {
            completion(false)
            return
        }
    } else if status == .denied || status == .restricted {
        completion(false)
        return
    }

    NSApplication.shared.setActivationPolicy(.regular)
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

func emitJSON<T: Encodable>(_ value: T) -> String {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(value),
          let json = String(data: data, encoding: .utf8) else {
        return #"{"ok":false,"error":"encode"}"#
    }

    return json
}

func dateFromMs(_ ms: Int64) -> Date {
    Date(timeIntervalSince1970: TimeInterval(ms) / 1000.0)
}

func msFromDate(_ date: Date) -> Int64 {
    Int64(date.timeIntervalSince1970 * 1000.0)
}

func statusLabel(for status: EKEventStatus) -> String {
    switch status {
    case .confirmed:
        return "confirmed"
    case .tentative:
        return "tentative"
    case .canceled:
        return "canceled"
    default:
        return "none"
    }
}

func attendeeStatusLabel(for status: EKParticipantStatus) -> String {
    switch status {
    case .accepted:
        return "accepted"
    case .declined:
        return "declined"
    case .tentative:
        return "tentative"
    case .pending:
        return "pending"
    default:
        return "unknown"
    }
}

func recurrenceLabel(for rule: EKRecurrenceRule?) -> String {
    guard let rule else {
        return ""
    }

    switch rule.frequency {
    case .daily:
        if rule.interval == 1,
           let days = rule.daysOfTheWeek,
           days.count == 5 {
            return "weekdays"
        }
        return "daily"
    case .weekly:
        return "weekly"
    case .monthly:
        return "monthly"
    case .yearly:
        return "yearly"
    @unknown default:
        return "custom"
    }
}

func buildRecurrenceRule(from value: String?) -> EKRecurrenceRule? {
    guard let value, !value.isEmpty, value != "none" else {
        return nil
    }

    switch value {
    case "daily":
        return EKRecurrenceRule(recurrenceWith: .daily, interval: 1, end: nil)
    case "weekdays":
        let days: [EKRecurrenceDayOfWeek] = [
            EKRecurrenceDayOfWeek(.monday),
            EKRecurrenceDayOfWeek(.tuesday),
            EKRecurrenceDayOfWeek(.wednesday),
            EKRecurrenceDayOfWeek(.thursday),
            EKRecurrenceDayOfWeek(.friday),
        ]
        return EKRecurrenceRule(
            recurrenceWith: .weekly,
            interval: 1,
            daysOfTheWeek: days,
            daysOfTheMonth: nil,
            monthsOfTheYear: nil,
            weeksOfTheYear: nil,
            daysOfTheYear: nil,
            setPositions: nil,
            end: nil
        )
    case "weekly":
        return EKRecurrenceRule(recurrenceWith: .weekly, interval: 1, end: nil)
    default:
        return nil
    }
}

func spanFrom(_ value: String?) -> EKSpan {
    if value == "futureEvents" {
        return .futureEvents
    }

    return .thisEvent
}

func payload(from event: EKEvent) -> CalendarFullEventPayload {
    let alarms = (event.alarms ?? []).compactMap { alarm -> CalendarAlarmPayload? in
        let minutes = Int(round(alarm.relativeOffset / 60.0))
        if minutes > 0 {
            return nil
        }
        return CalendarAlarmPayload(relativeOffsetMinutes: abs(minutes))
    }

    let attendees = (event.attendees ?? []).map { participant -> CalendarAttendeePayload in
        let name = participant.name ?? ""
        let email = participant.url.absoluteString
            .replacingOccurrences(of: "mailto:", with: "")
        return CalendarAttendeePayload(
            name: name,
            email: email,
            status: attendeeStatusLabel(for: participant.participantStatus),
            isOrganizer: participant.participantRole == .chair,
            isOptional: participant.participantRole == .optional
        )
    }

    let calendar = event.calendar
    let allowsEdit = calendar?.allowsContentModifications ?? false

    return CalendarFullEventPayload(
        id: event.eventIdentifier ?? "",
        title: event.title ?? "(Sem título)",
        startAt: msFromDate(event.startDate),
        endAt: msFromDate(event.endDate),
        location: event.location ?? "",
        calendarId: calendar?.calendarIdentifier ?? "",
        calendarName: calendar?.title ?? "",
        colorHex: hexFrom(calendar?.color),
        allDay: event.isAllDay,
        notes: event.notes ?? "",
        url: event.url?.absoluteString ?? "",
        status: statusLabel(for: event.status),
        hasRecurrence: event.hasRecurrenceRules,
        recurrenceLabel: recurrenceLabel(for: event.recurrenceRules?.first),
        allowsEdit: allowsEdit,
        alarms: alarms,
        attendees: attendees
    )
}

func fetchTodayDelimited(store: EKEventStore) -> String {
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

    for event in events.prefix(3) {
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

func fetchCalendars(store: EKEventStore) -> String {
    var accountMap: [String: (title: String, calendars: [CalendarListItemPayload])] = [:]

    for calendar in store.calendars(for: .event) {
        guard let source = calendar.source else {
            continue
        }
        let sourceId = source.sourceIdentifier
        let sourceTitle = source.title.isEmpty ? "Outros" : source.title
        let item = CalendarListItemPayload(
            id: calendar.calendarIdentifier,
            title: calendar.title,
            colorHex: hexFrom(calendar.color),
            allowsEdit: calendar.allowsContentModifications,
            sourceId: sourceId,
            sourceTitle: sourceTitle
        )

        if var existing = accountMap[sourceId] {
            existing.calendars.append(item)
            accountMap[sourceId] = existing
        } else {
            accountMap[sourceId] = (title: sourceTitle, calendars: [item])
        }
    }

    let accounts = accountMap
        .map { key, value in
            CalendarAccountPayload(
                id: key,
                title: value.title,
                calendars: value.calendars.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            )
        }
        .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }

    return emitJSON(CalendarCalendarsSnapshot(accessGranted: true, accounts: accounts))
}

func fetchEventsInRange(store: EKEventStore, startMs: Int64, endMs: Int64) -> String {
    guard startMs > 0, endMs > startMs else {
        return emitJSON(CalendarRangeEventsSnapshot(accessGranted: true, available: false, events: []))
    }

    let start = dateFromMs(startMs)
    let end = dateFromMs(endMs)
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
    let events = store.events(matching: predicate).sorted { left, right in
        if left.startDate == right.startDate {
            return (left.title ?? "") < (right.title ?? "")
        }

        return left.startDate < right.startDate
    }

    let payloads = events.map { payload(from: $0) }
    return emitJSON(CalendarRangeEventsSnapshot(accessGranted: true, available: true, events: payloads))
}

func createEvent(store: EKEventStore, json: String) -> String {
    guard let data = json.data(using: .utf8),
          let input = try? JSONDecoder().decode(CalendarCreateInput.self, from: data) else {
        return emitJSON(CalendarMutationResult(ok: false, event: nil, error: "invalid_input"))
    }

    guard let calendar = store.calendar(withIdentifier: input.calendarId),
          calendar.allowsContentModifications else {
        return emitJSON(CalendarMutationResult(ok: false, event: nil, error: "calendar_readonly"))
    }

    let event = EKEvent(eventStore: store)
    event.title = input.title.isEmpty ? "(Sem título)" : input.title
    event.startDate = dateFromMs(input.startAt)
    event.endDate = dateFromMs(input.endAt)
    event.isAllDay = input.allDay ?? false
    event.location = input.location
    event.notes = input.notes
    event.calendar = calendar

    if let urlString = input.url, !urlString.isEmpty, let url = URL(string: urlString) {
        event.url = url
    }

    if let alertMinutes = input.alertMinutes, alertMinutes > 0 {
        event.alarms = [EKAlarm(relativeOffset: TimeInterval(-alertMinutes * 60))]
    }

    if let rule = buildRecurrenceRule(from: input.recurrence) {
        event.recurrenceRules = [rule]
    }

    do {
        try store.save(event, span: .thisEvent, commit: true)
        return emitJSON(CalendarMutationResult(ok: true, event: payload(from: event), error: nil))
    } catch {
        return emitJSON(CalendarMutationResult(ok: false, event: nil, error: error.localizedDescription))
    }
}

func updateEvent(store: EKEventStore, json: String) -> String {
    guard let data = json.data(using: .utf8),
          let input = try? JSONDecoder().decode(CalendarUpdateInput.self, from: data) else {
        return emitJSON(CalendarMutationResult(ok: false, event: nil, error: "invalid_input"))
    }

    guard let event = store.event(withIdentifier: input.id) else {
        return emitJSON(CalendarMutationResult(ok: false, event: nil, error: "not_found"))
    }

    guard event.calendar.allowsContentModifications else {
        return emitJSON(CalendarMutationResult(ok: false, event: nil, error: "readonly"))
    }

    if let title = input.title {
        event.title = title.isEmpty ? "(Sem título)" : title
    }

    if let startAt = input.startAt {
        event.startDate = dateFromMs(startAt)
    }

    if let endAt = input.endAt {
        event.endDate = dateFromMs(endAt)
    }

    if let allDay = input.allDay {
        event.isAllDay = allDay
    }

    if let location = input.location {
        event.location = location
    }

    if let notes = input.notes {
        event.notes = notes
    }

    if let calendarId = input.calendarId,
       let calendar = store.calendar(withIdentifier: calendarId),
       calendar.allowsContentModifications {
        event.calendar = calendar
    }

    if let urlString = input.url {
        if urlString.isEmpty {
            event.url = nil
        } else if let url = URL(string: urlString) {
            event.url = url
        }
    }

    if let alertMinutes = input.alertMinutes {
        if alertMinutes <= 0 {
            event.alarms = nil
        } else {
            event.alarms = [EKAlarm(relativeOffset: TimeInterval(-alertMinutes * 60))]
        }
    }

    if let recurrence = input.recurrence {
        if let rule = buildRecurrenceRule(from: recurrence) {
            event.recurrenceRules = [rule]
        } else {
            event.recurrenceRules = nil
        }
    }

    do {
        try store.save(event, span: spanFrom(input.span), commit: true)
        return emitJSON(CalendarMutationResult(ok: true, event: payload(from: event), error: nil))
    } catch {
        return emitJSON(CalendarMutationResult(ok: false, event: nil, error: error.localizedDescription))
    }
}

func deleteEvent(store: EKEventStore, json: String) -> String {
    guard let data = json.data(using: .utf8),
          let input = try? JSONDecoder().decode(CalendarDeleteInput.self, from: data) else {
        return emitJSON(CalendarMutationResult(ok: false, event: nil, error: "invalid_input"))
    }

    guard let event = store.event(withIdentifier: input.id) else {
        return emitJSON(CalendarMutationResult(ok: false, event: nil, error: "not_found"))
    }

    guard event.calendar.allowsContentModifications else {
        return emitJSON(CalendarMutationResult(ok: false, event: nil, error: "readonly"))
    }

    do {
        try store.remove(event, span: spanFrom(input.span), commit: true)
        return emitJSON(CalendarMutationResult(ok: true, event: nil, error: nil))
    } catch {
        return emitJSON(CalendarMutationResult(ok: false, event: nil, error: error.localizedDescription))
    }
}

func handleAction(store: EKEventStore, action: String, args: [String]) -> String {
    switch action {
    case "calendars":
        return fetchCalendars(store: store)
    case "events":
        let startMs = Int64(args.first ?? "") ?? 0
        let endMs = Int64(args.count > 1 ? args[1] : "") ?? 0
        return fetchEventsInRange(store: store, startMs: startMs, endMs: endMs)
    case "create":
        return createEvent(store: store, json: args.first ?? "")
    case "update":
        return updateEvent(store: store, json: args.first ?? "")
    case "delete":
        return deleteEvent(store: store, json: args.first ?? "")
    case "requestAccess":
        return fetchTodayDelimited(store: store)
    default:
        return fetchTodayDelimited(store: store)
    }
}

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)
var output = "DENIED"
let arguments = Array(CommandLine.arguments.dropFirst())
let outputPath = arguments.first ?? ""
let action = arguments.count > 1 ? arguments[1] : ""
let actionArgs = arguments.count > 2 ? Array(arguments.dropFirst(2)) : []
let shouldPrompt = action == "requestAccess"

_ = NSApplication.shared

waitForPermission(store: store, prompt: shouldPrompt) { granted in
    if granted {
        if action.isEmpty {
            output = fetchTodayDelimited(store: store)
        } else {
            output = handleAction(store: store, action: action, args: actionArgs)
        }
    } else if !action.isEmpty {
        switch action {
        case "calendars":
            output = emitJSON(CalendarCalendarsSnapshot(accessGranted: false, accounts: []))
        case "events":
            output = emitJSON(CalendarRangeEventsSnapshot(accessGranted: false, available: false, events: []))
        case "requestAccess":
            output = "DENIED"
        default:
            output = emitJSON(CalendarMutationResult(ok: false, event: nil, error: "denied"))
        }
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
