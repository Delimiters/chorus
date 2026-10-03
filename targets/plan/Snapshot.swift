import Foundation

/// What the app leaves for the widget to read.
///
/// A widget runs as its own process and cannot execute the app's JavaScript,
/// so it cannot ask the engine what is due — it reads a small file the app
/// writes into the shared App Group container whenever its own data changes.
///
/// Deliberately a *projection*, not a database: no schedules, no rules, no
/// rotation. The engine stays the single place that decides what is due; this
/// is the answer it already computed, written down. Anything clever here would
/// be a second scheduler, and the two would drift — the failure this codebase
/// has a whole postmortem about.
struct Snapshot: Codable {
    struct Row: Codable, Identifiable {
        /// The occurrence key. What a tick is addressed to, and unique per day.
        let id: String
        let title: String
        let done: Bool
        /// Hex for whoever it belongs to, or nil for shared work.
        let ink: String?
    }

    let day: String
    let doneCount: Int
    let totalCount: Int
    let rows: [Row]
    /// When the app last wrote this. Shown when it is old enough to matter.
    let writtenAt: Date

    static let appGroup = "group.com.delimiters.chorus"
    static let fileName = "plan-snapshot.json"

    static var fileURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(fileName)
    }

    /// Reads the snapshot, or nil when the app has never written one.
    ///
    /// Returning nil rather than an empty plan matters: an empty plan is a
    /// real state ("nothing left today") and the widget says so proudly. "I
    /// have not been told yet" is a different thing and gets different words.
    static func load() -> Snapshot? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(Snapshot.self, from: data)
    }

    /// Ticks one row in place, so the widget can reflect a tap immediately.
    ///
    /// The app is the one that actually writes the completion to the database
    /// — this only moves the local snapshot so the box fills the instant it is
    /// tapped, rather than at the end of a round trip the user cannot see.
    static func markDone(id: String) {
        guard let url = fileURL, let current = load() else { return }
        let rows = current.rows.map { row in
            row.id == id
                ? Row(id: row.id, title: row.title, done: true, ink: row.ink)
                : row
        }
        let next = Snapshot(
            day: current.day,
            doneCount: current.doneCount + (current.rows.first { $0.id == id }?.done == false ? 1 : 0),
            totalCount: current.totalCount,
            rows: rows,
            writtenAt: current.writtenAt
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(next) {
            try? data.write(to: url, options: .atomic)
        }
    }
}
