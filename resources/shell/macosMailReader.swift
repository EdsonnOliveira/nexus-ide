import Foundation
import SQLite3

struct MailMailboxPayload: Codable {
    let id: String
    let accountName: String
    let mailboxName: String
    let label: String
}

struct MailMailboxesSnapshot: Codable {
    let accessGranted: Bool
    let options: [MailMailboxPayload]
}

struct MailMessagePayload: Codable {
    let id: String
    let subject: String
    let sender: String
    let dateReceived: Double
    let unread: Bool
}

struct MailInboxPayload: Codable {
    let accessGranted: Bool
    let available: Bool
    let mailboxLabel: String
    let messages: [MailMessagePayload]
}

private let mailIdDelimiter = "\u{001d}"
private let maxMailMessages = 80

private func emitMailJSON<T: Encodable>(_ value: T, outputPath: String?) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(value),
          let json = String(data: data, encoding: .utf8) else {
        return
    }

    if let outputPath {
        try? json.write(toFile: outputPath, atomically: true, encoding: .utf8)
    } else {
        print(json)
    }
}

private func mailHomePath() -> String {
    FileManager.default.homeDirectoryForCurrentUser.path
}

private func resolveMailVersionRoot() -> String? {
    let mailRoot = (mailHomePath() as NSString).appendingPathComponent("Library/Mail")
    guard let entries = try? FileManager.default.contentsOfDirectory(atPath: mailRoot) else {
        return nil
    }

    let versions = entries
        .filter { $0.range(of: #"^V\d+$"#, options: .regularExpression) != nil }
        .sorted { left, right in
            let leftNumber = Int(left.dropFirst()) ?? 0
            let rightNumber = Int(right.dropFirst()) ?? 0
            return leftNumber < rightNumber
        }

    guard let latest = versions.last else {
        return nil
    }

    return (mailRoot as NSString).appendingPathComponent(latest)
}

private func resolveEnvelopeIndexPath() -> String? {
    guard let versionRoot = resolveMailVersionRoot() else {
        return nil
    }

    let dbPath = (versionRoot as NSString).appendingPathComponent("MailData/Envelope Index")
    return FileManager.default.fileExists(atPath: dbPath) ? dbPath : nil
}

private func resolveAccountsPlistPath() -> String? {
    guard let versionRoot = resolveMailVersionRoot() else {
        return nil
    }

    let plistPath = (versionRoot as NSString).appendingPathComponent("MailData/Accounts.plist")
    return FileManager.default.fileExists(atPath: plistPath) ? plistPath : nil
}

private func openMailDatabaseCopy(at dbPath: String) -> (database: OpaquePointer, cleanupDir: String)? {
    let cleanupDir = NSTemporaryDirectory() + "nexus-mail-\(UUID().uuidString)"
    let fileManager = FileManager.default

    do {
        try fileManager.createDirectory(atPath: cleanupDir, withIntermediateDirectories: true)
        let tempDb = (cleanupDir as NSString).appendingPathComponent("Envelope Index")
        try fileManager.copyItem(atPath: dbPath, toPath: tempDb)

        let walPath = dbPath + "-wal"
        let shmPath = dbPath + "-shm"
        if fileManager.fileExists(atPath: walPath) {
            try? fileManager.copyItem(atPath: walPath, toPath: tempDb + "-wal")
        }
        if fileManager.fileExists(atPath: shmPath) {
            try? fileManager.copyItem(atPath: shmPath, toPath: tempDb + "-shm")
        }

        var database: OpaquePointer?
        if sqlite3_open_v2(tempDb, &database, SQLITE_OPEN_READONLY, nil) != SQLITE_OK {
            try? fileManager.removeItem(atPath: cleanupDir)
            return nil
        }

        guard let database else {
            try? fileManager.removeItem(atPath: cleanupDir)
            return nil
        }

        return (database, cleanupDir)
    } catch {
        try? fileManager.removeItem(atPath: cleanupDir)
        return nil
    }
}

private func stringColumn(_ statement: OpaquePointer?, index: Int32) -> String {
    guard let text = sqlite3_column_text(statement, index) else {
        return ""
    }

    return String(cString: text)
}

private func intColumn(_ statement: OpaquePointer?, index: Int32) -> Int64 {
    sqlite3_column_int64(statement, index)
}

private struct MailAccountInfo {
    let uuid: String
    let accountName: String
    let emailAddress: String
}

private func readStringValue(_ value: Any?) -> String {
    switch value {
    case let string as String:
        return string.trimmingCharacters(in: .whitespacesAndNewlines)
    case let number as NSNumber:
        return number.stringValue
    default:
        return ""
    }
}

private func readEmailAddresses(_ value: Any?) -> String {
    if let array = value as? [Any] {
        for item in array {
            let email = readStringValue(item)
            if !email.isEmpty {
                return email
            }
        }
    }

    return readStringValue(value)
}

private func loadAccountsFromPlist() -> [MailAccountInfo] {
    guard let plistPath = resolveAccountsPlistPath(),
          let data = try? Data(contentsOf: URL(fileURLWithPath: plistPath)),
          let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) else {
        return []
    }

    var rootAccounts: [Any] = []

    if let dictionary = plist as? [String: Any] {
        if let mailAccounts = dictionary["MailAccounts"] as? [Any] {
            rootAccounts = mailAccounts
        } else if let accounts = dictionary["Accounts"] as? [Any] {
            rootAccounts = accounts
        }
    } else if let array = plist as? [Any] {
        rootAccounts = array
    }

    var accounts: [MailAccountInfo] = []

    for entry in rootAccounts {
        guard let account = entry as? [String: Any] else {
            continue
        }

        let uuid = [
            readStringValue(account["AccountUUID"]),
            readStringValue(account["UniqueId"]),
            readStringValue(account["AccountPath"]),
            readStringValue(account["AccountID"]),
        ].first(where: { !$0.isEmpty }) ?? ""

        let accountName = [
            readStringValue(account["AccountName"]),
            readStringValue(account["Username"]),
            readEmailAddresses(account["EmailAddresses"]),
        ].first(where: { !$0.isEmpty }) ?? ""

        let emailAddress = readEmailAddresses(account["EmailAddresses"])

        if uuid.isEmpty || accountName.isEmpty {
            continue
        }

        accounts.append(
            MailAccountInfo(
                uuid: uuid,
                accountName: accountName,
                emailAddress: emailAddress
            )
        )
    }

    return accounts
}

private func buildAccountLabel(accountName: String, emailAddress: String) -> String {
    let trimmedName = accountName.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedEmail = emailAddress.trimmingCharacters(in: .whitespacesAndNewlines)

    if trimmedEmail.isEmpty || trimmedEmail == trimmedName {
        return trimmedName
    }

    return "\(trimmedName) (\(trimmedEmail))"
}

private func encodeMailboxId(accountName: String, mailboxName: String) -> String {
    "\(accountName)\(mailIdDelimiter)\(mailboxName)"
}

private func isInboxUrl(_ url: String) -> Bool {
    let normalized = url.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else {
        return false
    }

    let lowered = normalized.lowercased()
    if lowered.contains("spam") || lowered.contains("junk") || lowered.contains("trash")
        || lowered.contains("draft") || lowered.contains("sent") || lowered.contains("deleted") {
        return false
    }

    if lowered.hasSuffix("/inbox") || lowered.hasSuffix("/inbox/") {
        return true
    }

    let path = (normalized as NSString).lastPathComponent.lowercased()
    return path == "inbox"
}

private func extractAccountUuid(from url: String) -> String {
    guard let schemeRange = url.range(of: "://") else {
        return ""
    }

    let afterScheme = url[schemeRange.upperBound...]
    guard let slash = afterScheme.firstIndex(of: "/") else {
        return String(afterScheme)
    }

    return String(afterScheme[..<slash])
}

private func loadInboxUrls(from database: OpaquePointer) -> [(uuid: String, url: String)] {
    let sql = "SELECT url FROM mailboxes WHERE url IS NOT NULL;"
    var statement: OpaquePointer?

    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
        return []
    }

    defer { sqlite3_finalize(statement) }

    var results: [(uuid: String, url: String)] = []

    while sqlite3_step(statement) == SQLITE_ROW {
        let url = stringColumn(statement, index: 0)
        guard isInboxUrl(url) else {
            continue
        }

        let uuid = extractAccountUuid(from: url)
        if uuid.isEmpty {
            continue
        }

        results.append((uuid: uuid, url: url))
    }

    return results
}

func readMailMailboxes() -> MailMailboxesSnapshot {
    guard let dbPath = resolveEnvelopeIndexPath(),
          let opened = openMailDatabaseCopy(at: dbPath) else {
        return MailMailboxesSnapshot(accessGranted: false, options: [])
    }

    defer {
        sqlite3_close(opened.database)
        try? FileManager.default.removeItem(atPath: opened.cleanupDir)
    }

    let accounts = loadAccountsFromPlist()
    let inboxUrls = loadInboxUrls(from: opened.database)
    var options: [MailMailboxPayload] = []
    var seenAccountNames = Set<String>()

    if !accounts.isEmpty {
        for account in accounts {
            let hasInbox = inboxUrls.contains { $0.uuid.caseInsensitiveCompare(account.uuid) == .orderedSame }
            if !hasInbox {
                continue
            }

            if seenAccountNames.contains(account.accountName) {
                continue
            }

            seenAccountNames.insert(account.accountName)
            options.append(
                MailMailboxPayload(
                    id: encodeMailboxId(accountName: account.accountName, mailboxName: "INBOX"),
                    accountName: account.accountName,
                    mailboxName: "INBOX",
                    label: buildAccountLabel(accountName: account.accountName, emailAddress: account.emailAddress)
                )
            )
        }
    }

    if options.isEmpty {
        for inbox in inboxUrls {
            let accountName = inbox.uuid
            if seenAccountNames.contains(accountName) {
                continue
            }

            seenAccountNames.insert(accountName)
            options.append(
                MailMailboxPayload(
                    id: encodeMailboxId(accountName: accountName, mailboxName: "INBOX"),
                    accountName: accountName,
                    mailboxName: "INBOX",
                    label: accountName
                )
            )
        }
    }

    options.sort { $0.label.localizedStandardCompare($1.label) == .orderedAscending }
    return MailMailboxesSnapshot(accessGranted: true, options: options)
}

private func resolveAccountUuid(accountName: String, accounts: [MailAccountInfo]) -> String? {
    let trimmed = accountName.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        return nil
    }

    if let match = accounts.first(where: { $0.accountName == trimmed }) {
        return match.uuid
    }

    if let match = accounts.first(where: { $0.uuid.caseInsensitiveCompare(trimmed) == .orderedSame }) {
        return match.uuid
    }

    if let match = accounts.first(where: { $0.emailAddress.caseInsensitiveCompare(trimmed) == .orderedSame }) {
        return match.uuid
    }

    return trimmed
}

private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

func readMailInbox(accountName: String, mailboxName: String, limit: Int = maxMailMessages) -> MailInboxPayload {
    let safeLimit = min(max(limit, 1), maxMailMessages)
    let accounts = loadAccountsFromPlist()

    guard let dbPath = resolveEnvelopeIndexPath(),
          let opened = openMailDatabaseCopy(at: dbPath) else {
        return MailInboxPayload(
            accessGranted: false,
            available: false,
            mailboxLabel: "",
            messages: []
        )
    }

    defer {
        sqlite3_close(opened.database)
        try? FileManager.default.removeItem(atPath: opened.cleanupDir)
    }

    guard let accountUuid = resolveAccountUuid(accountName: accountName, accounts: accounts) else {
        return MailInboxPayload(
            accessGranted: true,
            available: false,
            mailboxLabel: accountName,
            messages: []
        )
    }

    let accountLabel = accounts.first(where: { $0.uuid.caseInsensitiveCompare(accountUuid) == .orderedSame })
    let mailboxLabel = accountLabel?.accountName ?? accountName
    let normalizedMailbox = mailboxName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? "INBOX"
        : mailboxName.trimmingCharacters(in: .whitespacesAndNewlines)

    let sql = """
    SELECT m.ROWID,
           COALESCE(s.subject, ''),
           CASE
             WHEN COALESCE(a.comment, '') != '' AND COALESCE(a.address, '') != ''
               THEN a.comment || ' <' || a.address || '>'
             WHEN COALESCE(a.comment, '') != '' THEN a.comment
             ELSE COALESCE(a.address, '')
           END,
           COALESCE(m.date_received, 0),
           COALESCE(m.read, 1),
           COALESCE(mb.url, '')
    FROM messages m
    JOIN mailboxes mb ON m.mailbox = mb.ROWID
    LEFT JOIN subjects s ON m.subject = s.ROWID
    LEFT JOIN addresses a ON m.sender = a.ROWID
    WHERE COALESCE(m.deleted, 0) = 0
      AND mb.url LIKE ?
    ORDER BY m.date_received DESC
    LIMIT ?;
    """

    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(opened.database, sql, -1, &statement, nil) == SQLITE_OK else {
        return MailInboxPayload(
            accessGranted: true,
            available: false,
            mailboxLabel: mailboxLabel,
            messages: []
        )
    }

    defer { sqlite3_finalize(statement) }

    let likePattern = "%\(accountUuid)/%"
    sqlite3_bind_text(statement, 1, likePattern, -1, sqliteTransient)
    sqlite3_bind_int64(statement, 2, Int64(safeLimit * 3))

    var messages: [MailMessagePayload] = []
    let targetMailbox = normalizedMailbox.lowercased()

    while sqlite3_step(statement) == SQLITE_ROW {
        let mailboxUrl = stringColumn(statement, index: 5)
        let urlPath = (mailboxUrl as NSString).lastPathComponent.lowercased()
        let isTargetInbox = targetMailbox == "inbox"
            ? isInboxUrl(mailboxUrl)
            : urlPath == targetMailbox || mailboxUrl.lowercased().hasSuffix("/\(targetMailbox)")

        if !isTargetInbox {
            continue
        }

        let subject = stringColumn(statement, index: 1)
        let sender = stringColumn(statement, index: 2)
        let dateReceived = Double(intColumn(statement, index: 3))
        let readFlag = intColumn(statement, index: 4)

        messages.append(
            MailMessagePayload(
                id: String(intColumn(statement, index: 0)),
                subject: subject.isEmpty ? "(Sem assunto)" : subject,
                sender: sender.isEmpty ? "Desconhecido" : sender,
                dateReceived: dateReceived * 1000,
                unread: readFlag == 0
            )
        )

        if messages.count >= safeLimit {
            break
        }
    }

    return MailInboxPayload(
        accessGranted: true,
        available: true,
        mailboxLabel: mailboxLabel,
        messages: messages
    )
}

func handleMailHelperAction(action: String, rawArgs: [String], outputPath: String?) -> Bool {
    if action == "mail-mailboxes" {
        emitMailJSON(readMailMailboxes(), outputPath: outputPath)
        return true
    }

    if action == "mail-inbox" {
        let accountName = rawArgs.count >= 3 ? rawArgs[2] : ""
        let mailboxName = rawArgs.count >= 4 ? rawArgs[3] : "INBOX"
        let limit = Int(rawArgs.count >= 5 ? rawArgs[4] : "\(maxMailMessages)") ?? maxMailMessages
        emitMailJSON(
            readMailInbox(accountName: accountName, mailboxName: mailboxName, limit: limit),
            outputPath: outputPath
        )
        return true
    }

    return false
}
