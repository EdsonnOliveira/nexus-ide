import AppKit
import Darwin
import Foundation
import UserNotifications

struct AgentFinishShownPayload: Codable {
    let shown: Bool
}

struct AgentFinishActionResult: Codable {
    let action: String
}

struct AgentFinishActionSpec {
    let id: String
    let title: String
}

private var runningAgentFinishNotifier: AgentFinishNotifier?

final class AgentFinishNotifier: NSObject, UNUserNotificationCenterDelegate {
    private let projectName: String
    private let projectId: String
    private let projectLogoPath: String
    private let bodyText: String
    private let actionItems: [AgentFinishActionSpec]
    private let categoryId: String
    private let outputPath: String?
    private var didFinish = false

    init(
        projectName: String,
        projectId: String,
        projectLogoPath: String,
        bodyText: String,
        actionItems: [AgentFinishActionSpec],
        outputPath: String?
    ) {
        self.projectName = projectName
        self.projectId = projectId
        self.projectLogoPath = projectLogoPath
        self.bodyText = bodyText
        self.actionItems = actionItems
        self.categoryId = "nexus.agent.actions"
        self.outputPath = outputPath
        super.init()
    }

    func run() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self

        let actions = Array(actionItems.prefix(4)).map { item in
            UNNotificationAction(
                identifier: item.id,
                title: item.title,
                options: item.id == "dismiss" || item.id == "ignore" ? [] : [.foreground]
            )
        }
        let category = UNNotificationCategory(
            identifier: categoryId,
            actions: actions,
            intentIdentifiers: [],
            options: [.customDismissAction]
        )
        center.setNotificationCategories([category])

        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            DispatchQueue.main.async {
                if !granted {
                    self.emitShown(false)
                    exit(0)
                }
                self.postNotification()
            }
        }

        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applyAppIcon()
        app.run()
    }

    private func resolveAppIconPath() -> String? {
        if let path = Bundle.main.path(forResource: "AppIcon", ofType: "icns") {
            return path
        }
        if let path = Bundle.main.path(forResource: "AppIcon", ofType: "png") {
            return path
        }

        let executable = URL(fileURLWithPath: Bundle.main.executablePath ?? CommandLine.arguments[0])
        let resources = executable
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Resources")
        let icns = resources.appendingPathComponent("AppIcon.icns").path
        if FileManager.default.fileExists(atPath: icns) {
            return icns
        }
        let png = resources.appendingPathComponent("AppIcon.png").path
        if FileManager.default.fileExists(atPath: png) {
            return png
        }
        return nil
    }

    private func applyAppIcon() {
        guard let path = resolveAppIconPath(), let image = NSImage(contentsOfFile: path) else {
            return
        }
        NSApp.applicationIconImage = image
    }

    private func logoAttachment() -> UNNotificationAttachment? {
        let trimmed = projectLogoPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, FileManager.default.fileExists(atPath: trimmed) else {
            return nil
        }

        let ext = (trimmed as NSString).pathExtension.lowercased()
        let filename = ext.isEmpty ? "project-logo.png" : "project-logo.\(ext)"
        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("nexus-agent-finish-\(UUID().uuidString)-\(filename)")
        do {
            try FileManager.default.copyItem(at: URL(fileURLWithPath: trimmed), to: tempURL)
            return try UNNotificationAttachment(
                identifier: "project-logo",
                url: tempURL,
                options: [UNNotificationAttachmentOptionsTypeHintKey: "public.png"]
            )
        } catch {
            return nil
        }
    }

    private func postNotification() {
        let center = UNUserNotificationCenter.current()
        center.removeAllDeliveredNotifications()
        center.removeAllPendingNotificationRequests()

        let content = UNMutableNotificationContent()
        content.title = projectName
        content.body = bodyText
        content.sound = .default
        content.categoryIdentifier = categoryId
        content.threadIdentifier = projectId.isEmpty ? "nexus-agent-finish" : projectId
        content.userInfo = [
            "projectName": projectName,
            "projectId": projectId,
        ]
        if let attachment = logoAttachment() {
            content.attachments = [attachment]
        }

        let request = UNNotificationRequest(
            identifier: projectId.isEmpty ? "nexus-agent-finish" : "nexus-agent-finish-\(projectId)",
            content: content,
            trigger: nil
        )

        center.add(request) { error in
            DispatchQueue.main.async {
                if error != nil {
                    self.emitShown(false)
                    exit(0)
                }
                self.emitShown(true)
                DispatchQueue.main.asyncAfter(deadline: .now() + 1800) {
                    self.emitAction("dismiss")
                }
            }
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let identifier = response.actionIdentifier
        if identifier == UNNotificationDismissActionIdentifier {
            emitAction("dismiss")
        } else if identifier == UNNotificationDefaultActionIdentifier {
            emitAction("open")
        } else {
            emitAction(identifier)
        }
        completionHandler()
    }

    private func emitShown(_ shown: Bool) {
        emitJSON(AgentFinishShownPayload(shown: shown))
    }

    private func emitAction(_ action: String) {
        if didFinish {
            return
        }
        didFinish = true
        emitJSON(AgentFinishActionResult(action: action))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            exit(0)
        }
    }

    private func emitJSON<T: Encodable>(_ payload: T) {
        guard let data = try? JSONEncoder().encode(payload),
              let json = String(data: data, encoding: .utf8) else {
            return
        }

        let line = json + "\n"
        if let bytes = line.data(using: .utf8) {
            FileHandle.standardOutput.write(bytes)
            fflush(stdout)
        }

        if let outputPath, !outputPath.isEmpty {
            try? json.write(toFile: outputPath, atomically: true, encoding: .utf8)
        }
    }
}

func runAgentFinishNotifier(
    projectName: String,
    projectId: String = "",
    projectLogoPath: String = "",
    body: String = "",
    actions: [AgentFinishActionSpec] = [],
    outputPath: String?
) {
    let trimmed = projectName.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedId = projectId.trimmingCharacters(in: .whitespacesAndNewlines)
    let resolvedName = trimmed.isEmpty ? "Projeto" : trimmed
    let resolvedBody = body.trimmingCharacters(in: .whitespacesAndNewlines)
    let actionItems = actions.isEmpty
        ? [
            AgentFinishActionSpec(id: "dismiss", title: "Ignorar"),
            AgentFinishActionSpec(id: "git", title: "Subir para o git"),
        ]
        : actions
    let notifier = AgentFinishNotifier(
        projectName: resolvedName,
        projectId: trimmedId,
        projectLogoPath: projectLogoPath.trimmingCharacters(in: .whitespacesAndNewlines),
        bodyText: resolvedBody.isEmpty
            ? "O agent finalizou, subir para o git?"
            : resolvedBody,
        actionItems: actionItems,
        outputPath: outputPath
    )
    runningAgentFinishNotifier = notifier
    notifier.run()
}
