import CoreWLAN
import Foundation

let client = CWWiFiClient.shared()

guard let iface = client.interface(withName: "en0") ?? client.interface() else {
    print("no_interface")
    exit(1)
}

let command = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "scan"

func resolveConnectedSsid(from networks: Set<CWNetwork>) -> String? {
    if let ssid = iface.ssid(), !ssid.isEmpty {
        return ssid
    }

    guard let currentBssid = iface.bssid(), !currentBssid.isEmpty else {
        return nil
    }

    return networks.first(where: { $0.bssid == currentBssid })?.ssid
}

if command == "connected" {
    if let ssid = iface.ssid(), !ssid.isEmpty {
        print(ssid)
        exit(0)
    }

    if let bssid = iface.bssid(), !bssid.isEmpty {
        if let networks = try? iface.scanForNetworks(withName: nil),
           let ssid = resolveConnectedSsid(from: networks),
           !ssid.isEmpty {
            print(ssid)
            exit(0)
        }

        print("__link_active__")
        exit(0)
    }

    if let networks = try? iface.scanForNetworks(withName: nil),
       let ssid = resolveConnectedSsid(from: networks),
       !ssid.isEmpty {
        print(ssid)
        exit(0)
    }

    print("")
    exit(0)
}

if command == "disconnect" {
    iface.disassociate()
    print("ok")
    exit(0)
}

if command == "scan" {
    do {
        let networks = try iface.scanForNetworks(withName: nil)
        let currentSsid = resolveConnectedSsid(from: networks) ?? (iface.ssid() ?? "")
        let currentBssid = iface.bssid()

        for network in networks {
            guard let ssid = network.ssid, !ssid.isEmpty else {
                continue
            }

            let secured = network.supportsSecurity(.none) ? "0" : "1"
            let matchesSsid = !currentSsid.isEmpty && ssid == currentSsid
            let matchesBssid =
                currentBssid != nil &&
                network.bssid == currentBssid
            let active = matchesSsid || matchesBssid ? "1" : "0"
            print("\(ssid)\t\(secured)\t\(active)")
        }
    } catch {
        fputs("error: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
}
