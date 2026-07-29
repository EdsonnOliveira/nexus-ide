import AppKit
import Foundation
import Speech

final class SpeechWorker {
  private let wavURL: URL
  private var transcript = ""
  private var finished = false

  init(wavURL: URL) {
    self.wavURL = wavURL
  }

  func start() {
    let status = SFSpeechRecognizer.authorizationStatus()
    if status == .notDetermined {
      SFSpeechRecognizer.requestAuthorization { [weak self] newStatus in
        DispatchQueue.main.async {
          self?.recognize(with: newStatus)
        }
      }
      return
    }
    recognize(with: status)
  }

  private func finish(successText: String?, error: String?) {
    guard !finished else { return }
    finished = true
    if let error {
      fputs(error + "\n", stderr)
      fflush(stderr)
      _exit(7)
    }
    guard let successText, !successText.isEmpty else {
      fputs("empty transcript\n", stderr)
      fflush(stderr)
      _exit(8)
    }
    fputs(successText + "\n", stdout)
    fflush(stdout)
    _exit(0)
  }

  private func recognize(with status: SFSpeechRecognizerAuthorizationStatus) {
    guard status == .authorized else {
      finish(successText: nil, error: "speech recognition not authorized")
      return
    }

    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "pt-BR")) ?? SFSpeechRecognizer() else {
      finish(successText: nil, error: "speech recognizer unavailable")
      return
    }

    guard recognizer.isAvailable else {
      finish(successText: nil, error: "speech recognizer unavailable")
      return
    }

    let request = SFSpeechURLRecognitionRequest(url: wavURL)
    request.shouldReportPartialResults = false
    if #available(macOS 13.0, *) {
      request.addsPunctuation = true
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in
      self?.finish(successText: nil, error: "speech recognition timeout")
    }

    recognizer.recognitionTask(with: request) { [weak self] result, error in
      DispatchQueue.main.async {
        guard let self else { return }
        if let error {
          self.finish(successText: nil, error: error.localizedDescription)
          return
        }
        guard let result else { return }
        self.transcript = result.bestTranscription.formattedString
        if result.isFinal {
          let trimmed = self.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
          self.finish(successText: trimmed, error: nil)
        }
      }
    }
  }
}

guard CommandLine.arguments.count >= 2 else {
  fputs("usage: macosSpeechToText <wav-path>\n", stderr)
  exit(2)
}

let wavPath = CommandLine.arguments[1]
guard FileManager.default.fileExists(atPath: wavPath) else {
  fputs("audio file not found\n", stderr)
  exit(3)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let worker = SpeechWorker(wavURL: URL(fileURLWithPath: wavPath))
DispatchQueue.main.async {
  worker.start()
}

app.run()
