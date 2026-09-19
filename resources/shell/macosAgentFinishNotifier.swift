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

private var runningAgentFinishNotifier: AgentFinishNotifier?

final class AgentFinishNotifier: NSObject, UNUserNotificationCenterDelegate {
    private let projectName: String
    private let outputPath: String?
    private var didFinish = false

    init(projectName: String, outputPath: String?) {
        self.projectName = projectName
        self.outputPath = outputPath
        super.init()
    }

    func run() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self

        let git = UNNotificationAction(
            identifier: "git",
            title: "Subir para o git",
            options: [.foreground]
        )
        let ignore = UNNotificationAction(
            identifier: "ignore",
            title: "Ignorar",
            options: []
        )
        let category = UNNotificationCategory(
            identifier: "nexus.agent.finish.git",
            actions: [git, ignore],
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
        app.run()
    }

    private func postNotification() {
        let content = UNMutableNotificationContent()
        content.title = "Nexus"
        content.body = "O agent de \(projectName) finalizou, subir para o git?"
        content.sound = .default
        content.categoryIdentifier = "nexus.agent.finish.git"

        let request = UNNotificationRequest(
            identifier: "nexus-agent-finish-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request) { error in
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
        if identifier == "git" {
            emitAction("git")
        } else if identifier == "ignore" || identifier == UNNotificationDismissActionIdentifier {
            emitAction("dismiss")
        } else {
            emitAction("open")
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

func runAgentFinishNotifier(projectName: String, outputPath: String?) {
    let trimmed = projectName.trimmingCharacters(in: .whitespacesAndNewlines)
    let notifier = AgentFinishNotifier(
        projectName: trimmed.isEmpty ? "Projeto" : trimmed,
        outputPath: outputPath
    )
    runningAgentFinishNotifier = notifier
    notifier.run()
}
