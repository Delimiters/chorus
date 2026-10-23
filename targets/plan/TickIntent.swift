import AppIntents
import WidgetKit

/// Ticking a chore from the home screen.
///
/// iOS 17 and up lets a widget run an App Intent from a Button without
/// launching the app, which is the whole reason this widget is worth building:
/// the common interaction with Chorus is "that's done", and making you open an
/// app to say so is most of the friction.
///
/// It writes an *intent to complete* into the shared container and reloads the
/// timeline. The app picks that up and does the real write — against the
/// engine, with the right occurrence key and the right `completedOn` — the
/// next time it runs. Doing the Supabase write from here would mean a second
/// copy of the completion rules living in Swift, and the two would disagree
/// about exactly the things this project has already been bitten by: which day
/// a tick belongs to, and what it does to an interval chore's next date.
@available(iOS 17.0, *)
struct TickIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark done"
    static var description = IntentDescription("Marks a chore done on today's plan.")

    @Parameter(title: "Occurrence")
    var occurrenceKey: String

    init() {}

    init(occurrenceKey: String) {
        self.occurrenceKey = occurrenceKey
    }

    func perform() async throws -> some IntentResult {
        PendingTicks.add(occurrenceKey)
        Snapshot.markDone(id: occurrenceKey)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

/// Ticks made on the home screen that the app has not yet written down.
///
/// A queue rather than a flag, because several can happen between two launches
/// — and keyed by occurrence, so replaying it twice is the same as replaying
/// it once. That idempotency is not incidental: `unique (chore_id,
/// occurrence_key)` in the database is what makes the app's own optimistic
/// ticking safe, and this rides on the same guarantee.
enum PendingTicks {
    static let key = "pendingTicks"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: Snapshot.appGroup)
    }

    static func add(_ occurrenceKey: String) {
        guard let defaults else { return }
        var keys = defaults.stringArray(forKey: key) ?? []
        guard !keys.contains(occurrenceKey) else { return }
        keys.append(occurrenceKey)
        defaults.set(keys, forKey: key)
    }
}
