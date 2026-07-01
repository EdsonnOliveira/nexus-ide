import Foundation
import SQLite3

struct NotificationPayload: Codable {
    let id: String
    let appId: String
    let appLabel: String
    let title: String
    let body: String
    let deliveredAt: Double
}

struct NotificationSnapshot: Codable {
    let accessGranted: Bool
    let items: [NotificationPayload]
}

struct MutationResult: Codable {
    let success: Bool
    let accessGranted: Bool
}

let appleEpochMs: Double = 978_307_200_000

let knownAppLabels: [String: String] = [
    "com.openai.chat": "ChatGPT",
    "com.openai.chatgpt": "ChatGPT",
    "com.apple.MobileSMS": "Mensagens",
    "com.tinyspeck.slackmacgap": "Slack",
    "com.google.Chrome": "Chrome",
    "com.apple.mail": "Mail",
    "com.apple.iChat": "Mensagens",
    "net.whatsapp.WhatsApp": "WhatsApp",
    "com.hnc.Discord": "Discord",
    "com.spotify.client": "Spotify",
]

func emitSnapshot(_ snapshot: NotificationSnapshot, outputPath: String? = nil) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(snapshot),
          let json = String(data: data, encoding: .utf8) else {
        let fallback = "{\"accessGranted\":false,\"items\":[]}"
        if let outputPath {
            try? fallback.write(toFile: outputPath, atomically: true, encoding: .utf8)
        } else {
            print(fallback)
        }
        return
    }

    if let outputPath {
        try? json.write(toFile: outputPath, atomically: true, encoding: .utf8)
    } else {
        print(json)
    }
}

func emitMutationResult(_ result: MutationResult, outputPath: String? = nil) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(result),
          let json = String(data: data, encoding: .utf8) else {
        let fallback = "{\"success\":false,\"accessGranted\":false}"
        if let outputPath {
            try? fallback.write(toFile: outputPath, atomically: true, encoding: .utf8)
        } else {
            print(fallback)
        }
        return
    }

    if let outputPath {
        try? json.write(toFile: outputPath, atomically: true, encoding: .utf8)
    } else {
        print(json)
    }
}

func formatAppLabel(_ identifier: String) -> String {
    if identifier.isEmpty {
        return "Sistema"
    }

    if let known = knownAppLabels[identifier] {
        return known
    }

    let segment = identifier.split(separator: ".").last.map(String.init) ?? identifier
    return segment.replacingOccurrences(
        of: "([a-z0-9])([A-Z])",
        with: "$1 $2",
        options: .regularExpression
    )
}

func extractText(_ value: Any?) -> String {
    switch value {
    case let string as String:
        return string.trimmingCharacters(in: .whitespacesAndNewlines)
    case let number as NSNumber:
        return number.stringValue
    case let array as [Any]:
        return array.compactMap { extractText($0) }.filter { !$0.isEmpty }.joined(separator: " ")
    case let dictionary as [String: Any]:
        for key in ["title", "titl", "subt", "sub", "subtitle", "body", "desc", "text", "message"] {
            let extracted = extractText(dictionary[key])
            if !extracted.isEmpty {
                return extracted
            }
        }

        for nested in dictionary.values {
            let extracted = extractText(nested)
            if !extracted.isEmpty {
                return extracted
            }
        }
        return ""
    default:
        return ""
    }
}

func firstNonEmpty(_ values: String...) -> String {
    for value in values where !value.isEmpty {
        return value
    }
    return ""
}

func parseNotificationBlob(_ data: Data) -> (title: String, body: String, appId: String, deliveredAt: Double)? {
    guard !data.isEmpty else {
        return nil
    }

    var format = PropertyListSerialization.PropertyListFormat.binary
    guard let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: &format) else {
        return nil
    }

    guard let root = plist as? [String: Any] else {
        return nil
    }

    let req = root["req"] as? [String: Any] ?? [:]
    let alert = (root["aps"] as? [String: Any])?["alert"]
    let alertDictionary = alert as? [String: Any] ?? [:]
    let alertString = alert as? String ?? ""

    let title = firstNonEmpty(
        extractText(req["titl"]),
        extractText(req["title"]),
        extractText(req["subt"]),
        extractText(req["sub"]),
        extractText(alertDictionary["title"]),
        alertString
    )
    let body = firstNonEmpty(
        extractText(req["body"]),
        extractText(req["desc"]),
        extractText(alertDictionary["body"]),
        extractText(alertDictionary["subtitle"])
    )
    let appId = root["app"] as? String ?? ""

    var deliveredAt = Date().timeIntervalSince1970 * 1000
    if let date = root["date"] as? Double {
        deliveredAt = appleEpochMs + date * 1000
    }

    if title.isEmpty && body.isEmpty {
        return nil
    }

    return (
        title: title.isEmpty ? formatAppLabel(appId) : title,
        body: body,
        appId: appId,
        deliveredAt: deliveredAt
    )
}

func legacyDarwinDbPath() -> String {
    let tempDir = URL(fileURLWithPath: NSTemporaryDirectory()).deletingLastPathComponent().deletingLastPathComponent()
    return tempDir.appendingPathComponent("0/com.apple.notificationcenter/db2/db").path
}

func dbCandidates() -> [String] {
    let home = NSHomeDirectory()
    var paths = [
        "\(home)/Library/Group Containers/group.com.apple.usernoted/db2/db",
        legacyDarwinDbPath(),
    ]

    if let darwinUserDir = getenv("DARWIN_USER_DIR") {
        let darwinPath = String(cString: darwinUserDir)
        paths.append("\(darwinPath)com.apple.notificationcenter/db2/db")
    }

    return paths
}

func openDatabase(at sourcePath: String) -> (database: OpaquePointer, copiedPath: String, cleanupDir: String)? {
    let sourceDir = (sourcePath as NSString).deletingLastPathComponent
    let copyDir = NSTemporaryDirectory() + "nexus-notif-dir-\(UUID().uuidString)"
    let copiedPath = (copyDir as NSString).appendingPathComponent("db")

    do {
        try FileManager.default.createDirectory(atPath: copyDir, withIntermediateDirectories: true)

        for fileName in ["db", "db-wal", "db-shm"] {
            let sourceFile = (sourceDir as NSString).appendingPathComponent(fileName)

            if FileManager.default.fileExists(atPath: sourceFile) {
                let destinationFile = (copyDir as NSString).appendingPathComponent(fileName)
                try FileManager.default.copyItem(atPath: sourceFile, toPath: destinationFile)
            }
        }
    } catch {
        try? FileManager.default.removeItem(atPath: copyDir)
        return nil
    }

    var database: OpaquePointer?
    let uri = "file:\(copiedPath)?mode=ro&immutable=1"

    guard sqlite3_open_v2(uri, &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI, nil) == SQLITE_OK,
          let database else {
        try? FileManager.default.removeItem(atPath: copyDir)
        return nil
    }

    return (database, copiedPath, copyDir)
}

func openWritableDatabase() -> (database: OpaquePointer, path: String)? {
    guard let dbPath = resolveActiveNotificationDbPath() else {
        return nil
    }

    var database: OpaquePointer?
    let openResult = sqlite3_open_v2(dbPath, &database, SQLITE_OPEN_READWRITE, nil)

    guard openResult == SQLITE_OK, let database else {
        return nil
    }

    sqlite3_busy_timeout(database, 5000)
    return (database, dbPath)
}

func resolveActiveNotificationDbPath() -> String? {
    for candidate in dbCandidates() {
        guard FileManager.default.fileExists(atPath: candidate) else {
            continue
        }

        if openDatabase(at: candidate) != nil {
            return candidate
        }
    }

    return nil
}

func checkpointWritableDatabase(_ database: OpaquePointer) {
    var log: Int32 = 0
    var checkpoint: Int32 = 0
    sqlite3_wal_checkpoint_v2(database, nil, SQLITE_CHECKPOINT_TRUNCATE, &log, &checkpoint)
}

func runDeleteStatement(
    _ database: OpaquePointer,
    _ sql: String,
    bind: ((OpaquePointer?) -> Void)? = nil,
) -> Bool {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
        return false
    }

    defer {
        sqlite3_finalize(statement)
    }

    bind?(statement)

    guard sqlite3_step(statement) == SQLITE_DONE else {
        return false
    }

    return sqlite3_changes(database) > 0
}

func deleteNotification(recId: Int64) -> MutationResult {
    guard recId > 0, let opened = openWritableDatabase() else {
        return MutationResult(success: false, accessGranted: false)
    }

    defer {
        checkpointWritableDatabase(opened.database)
        sqlite3_close(opened.database)
    }

    let deleted = runDeleteStatement(
        opened.database,
        "DELETE FROM record WHERE rec_id = ?;",
    ) { statement in
        sqlite3_bind_int64(statement, 1, recId)
    }

    return MutationResult(success: deleted, accessGranted: true)
}

func deleteAllNotifications(limit: Int) -> MutationResult {
    guard let opened = openWritableDatabase() else {
        return MutationResult(success: false, accessGranted: false)
    }

    defer {
        checkpointWritableDatabase(opened.database)
        sqlite3_close(opened.database)
    }

    let safeLimit = min(max(limit, 1), 500)
    let limitedQuery = """
    DELETE FROM record WHERE rec_id IN (
        SELECT r.rec_id
        FROM record r
        WHERE r.delivered_date IS NOT NULL
        ORDER BY r.delivered_date DESC
        LIMIT ?;
    );
    """

    var deleted = runDeleteStatement(opened.database, limitedQuery) { statement in
        sqlite3_bind_int(statement, 1, Int32(safeLimit))
    }

    if !deleted {
        deleted = runDeleteStatement(
            opened.database,
            "DELETE FROM record WHERE delivered_date IS NOT NULL;",
        )
    }

    return MutationResult(success: deleted, accessGranted: true)
}

func loadItems(from database: OpaquePointer, limit: Int) -> [NotificationPayload] {
    let queries = [
        """
        SELECT r.rec_id, COALESCE(a.identifier, ''), r.delivered_date, r.data
        FROM record r
        LEFT JOIN app a ON r.app_id = a.app_id
        WHERE r.delivered_date IS NOT NULL
        ORDER BY r.delivered_date DESC
        LIMIT ?
        """,
        """
        SELECT r.rec_id, COALESCE(a.identifier, ''), r.delivered_date, r.data
        FROM record r
        LEFT JOIN app a ON r.app_id = a.app_id
        ORDER BY r.rec_id DESC
        LIMIT ?
        """,
    ]

    for query in queries {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, query, -1, &statement, nil) == SQLITE_OK else {
            continue
        }

        defer {
            sqlite3_finalize(statement)
        }

        sqlite3_bind_int(statement, 1, Int32(limit))

        var items: [NotificationPayload] = []

        while sqlite3_step(statement) == SQLITE_ROW {
            let recId = sqlite3_column_int64(statement, 0)
            let identifier = String(cString: sqlite3_column_text(statement, 1))
            let deliveredDate = sqlite3_column_double(statement, 2)
            let dataLength = sqlite3_column_bytes(statement, 3)

            var parsed: (title: String, body: String, appId: String, deliveredAt: Double)?

            if let dataPointer = sqlite3_column_blob(statement, 3), dataLength > 0 {
                let data = Data(bytes: dataPointer, count: Int(dataLength))
                parsed = parseNotificationBlob(data)
            }

            let deliveredAt = deliveredDate > 0
                ? appleEpochMs + deliveredDate * 1000
                : Date().timeIntervalSince1970 * 1000

            if let parsed {
                items.append(
                    NotificationPayload(
                        id: "sys-\(recId)",
                        appId: parsed.appId.isEmpty ? identifier : parsed.appId,
                        appLabel: formatAppLabel(parsed.appId.isEmpty ? identifier : parsed.appId),
                        title: parsed.title,
                        body: parsed.body,
                        deliveredAt: deliveredAt
                    )
                )
            } else if !identifier.isEmpty {
                items.append(
                    NotificationPayload(
                        id: "sys-\(recId)",
                        appId: identifier,
                        appLabel: formatAppLabel(identifier),
                        title: formatAppLabel(identifier),
                        body: "",
                        deliveredAt: deliveredAt
                    )
                )
            }
        }

        if !items.isEmpty {
            return items
        }
    }

    return []
}

func readNotifications(limit: Int) -> NotificationSnapshot {
    for candidate in dbCandidates() {
        guard let opened = openDatabase(at: candidate) else {
            continue
        }

        let database = opened.database
        let cleanupDir = opened.cleanupDir

        defer {
            sqlite3_close(database)
            try? FileManager.default.removeItem(atPath: cleanupDir)
        }

        let items = loadItems(from: database, limit: limit)
        return NotificationSnapshot(accessGranted: true, items: items)
    }

    return NotificationSnapshot(accessGranted: false, items: [])
}

let rawArgs = Array(CommandLine.arguments.dropFirst())
let outputPath = rawArgs.first
let action = rawArgs.count >= 2 ? rawArgs[1] : "list"

if action == "delete", rawArgs.count >= 3 {
    let recId = Int64(rawArgs[2]) ?? 0
    emitMutationResult(deleteNotification(recId: recId), outputPath: outputPath)
    exit(0)
}

if action == "delete-all" {
    let limit = Int(rawArgs.count >= 3 ? rawArgs[2] : "30") ?? 30
    let safeLimit = min(max(limit, 1), 50)
    emitMutationResult(deleteAllNotifications(limit: safeLimit), outputPath: outputPath)
    exit(0)
}

let limitArg = action == "list"
    ? (rawArgs.count >= 3 ? rawArgs[2] : "30")
    : (Int(action) != nil ? action : "30")
let limit = Int(limitArg) ?? 30
let safeLimit = min(max(limit, 1), 50)
emitSnapshot(readNotifications(limit: safeLimit), outputPath: outputPath)
exit(0)
