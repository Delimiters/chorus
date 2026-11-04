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

/**
 Taking a tick back from the home screen.

 Emily, on build 79: *"on the widget it's too easy to accidentally check a row,
 and then when she tried to uncheck that one she was accidentally checking
 other things"*.

 The second half of that was the worse half, and it was a design mistake rather
 than a mis-tap: a finished row was deliberately **not** a button, on the
 reasoning that a filled box which does nothing is a lie. True, and it left the
 widget with no way to undo at all — so the only thing to do with an accidental
 tick was tap at it again, which hit the rows either side. The app has had an
 undo toast since Emily's *"i accidentally checked something off and it
 disappeared 😭"*; the home screen needs the same recoverability, not a
 narrower target alone.
 */
@available(iOS 17.0, *)
struct UntickIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark not done"
    static var description = IntentDescription("Takes back a tick on today's plan.")

    @Parameter(title: "Occurrence")
    var occurrenceKey: String

    init() {}

    init(occurrenceKey: String) {
        self.occurrenceKey = occurrenceKey
    }

    func perform() async throws -> some IntentResult {
        PendingTicks.addUntick(occurrenceKey)
        Snapshot.markUndone(id: occurrenceKey)
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
    /**
     Un-ticks made on the home screen.

     A second queue rather than a signed value in the first, because the two
     are not opposites in the database: a tick inserts a completion and an
     un-tick deletes one, and the app replays each through the mutation that
     already knows how.

     Keeping them apart also means a tick and an un-tick of
     the same thing between two launches resolve to whichever the person did
     last, because each `enqueue` withdraws the key from the other queue.

     Precisely: it leaves **one** intention queued, not an empty pair. A
     cancelled tick-then-un-tick leaves an un-tick, which the app's drain then
     no-ops because the occurrence is not completed — so that guard is
     load-bearing rather than redundant. Removing it would let the leftover
     un-tick delete a completion the *other* person made in the meantime.
     */
    static let untickKey = "pendingUnticks"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: Snapshot.appGroup)
    }

    private static func enqueue(_ occurrenceKey: String, into queue: String, cancelling other: String) {
        guard let defaults else { return }

        /*
         * The opposite intention, withdrawn.
         *
         * Tick then un-tick before the app next opens should leave nothing to
         * replay, not one of each — and without this the app would apply them
         * in queue order and land wherever that happened to put it.
         */
        let opposite = (defaults.stringArray(forKey: other) ?? []).filter { $0 != occurrenceKey }
        if opposite.isEmpty {
            defaults.removeObject(forKey: other)
        } else {
            defaults.set(opposite, forKey: other)
        }

        var keys = defaults.stringArray(forKey: queue) ?? []
        guard !keys.contains(occurrenceKey) else { return }
        keys.append(occurrenceKey)
        defaults.set(keys, forKey: queue)
    }

    static func add(_ occurrenceKey: String) {
        enqueue(occurrenceKey, into: key, cancelling: untickKey)
    }

    static func addUntick(_ occurrenceKey: String) {
        enqueue(occurrenceKey, into: untickKey, cancelling: key)
    }
}
