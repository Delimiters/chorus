import ActivityKit
import ExpoModulesCore
import WidgetKit

/**
 The whole native surface between JavaScript and the home screen.

 A widget and a Live Activity each run in their own process. Neither can
 execute the app's JavaScript, and neither can see inside the app's sandbox —
 the only thing all three share is the App Group container, which nothing in
 Expo can reach. So this module exists to do four things and deliberately
 nothing else:

 - write the snapshot the widget reads,
 - ask WidgetKit to redraw now rather than at its own leisure,
 - drain the ticks made from the home screen, for the app to replay through
   the real completion path,
 - start, update and end the Live Activity.

 **It computes nothing.** The snapshot arrives as a JSON string the app already
 built from the projection it is rendering, and this writes those bytes
 unexamined. Anything cleverer here would be a second scheduler living in
 Swift, which is the exact failure `docs/POSTMORTEM-SWIFT.md` is about.
 */
public class WidgetBridgeModule: Module {
    /*
     * These three literals are duplicated in `targets/plan/Snapshot.swift` and
     * `targets/plan/TickIntent.swift`, because the extension and the app are
     * separate compilation units. `src/core/widget/contract.test.ts`
     * fails if they stop matching — the alternative is an app writing to one
     * path and a widget reading another, with no error on either side.
     */
    private static let appGroup = "group.com.delimiters.chorus"
    private static let snapshotFile = "plan-snapshot.json"
    private static let pendingTicksKey = "pendingTicks"

    private static var snapshotURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(snapshotFile)
    }

    public func definition() -> ModuleDefinition {
        Name("WidgetBridge")

        /**
         Writes the snapshot and returns whether it landed.

         Returns `false` rather than throwing when the App Group is not
         reachable, which happens on a build whose provisioning profile lacks
         the group. The caller treats that as "no widget on this install" and
         carries on: a failed widget write must never break the app's own
         rendering.
         */
        Function("writeSnapshot") { (json: String) -> Bool in
            guard let url = Self.snapshotURL, let data = json.data(using: .utf8) else {
                return false
            }
            do {
                // Atomic: the widget may read at any moment, including during
                // this write, and half a JSON document decodes to nothing.
                try data.write(to: url, options: .atomic)
                return true
            } catch {
                return false
            }
        }

        /// Asks every placed widget to rebuild its timeline.
        Function("reloadTimelines") {
            WidgetCenter.shared.reloadAllTimelines()
        }

        /**
         The ticks made from the home screen. **Does not clear them.**

         Read-then-acknowledge, in two calls, because the first version took and
         cleared in one and lost ticks for real. Two ways:

         - On a cold start the app's queries have not resolved, so every key
           looked up nothing and was dropped as "archived" — a tick made on the
           lock screen before opening the app simply vanished.
         - Offline, the completion mutation rejects immediately (`retry: 0`) and
           the optimistic update rolls back, leaving no record anywhere that the
           tap happened.

         Neither failed loudly, and the only feedback channel — the box filling
         in the widget — lives in this process and would never be corrected.
         Now nothing is forgotten until the database has it.
         */
        Function("pendingTicks") { () -> [String] in
            guard let defaults = UserDefaults(suiteName: Self.appGroup) else { return [] }
            return defaults.stringArray(forKey: Self.pendingTicksKey) ?? []
        }

        /**
         Forgets the keys the app has now written down.

         Removes only what it is given, rather than clearing the lot: a tick
         made *while* the app was replaying an earlier batch would otherwise be
         thrown away unprocessed.
         */
        Function("acknowledgeTicks") { (keys: [String]) in
            guard let defaults = UserDefaults(suiteName: Self.appGroup) else { return }
            let done = Set(keys)
            let remaining = (defaults.stringArray(forKey: Self.pendingTicksKey) ?? [])
                .filter { !done.contains($0) }
            if remaining.isEmpty {
                defaults.removeObject(forKey: Self.pendingTicksKey)
            } else {
                defaults.set(remaining, forKey: Self.pendingTicksKey)
            }
        }

        /**
         Starts the activity, or updates the one already running.

         There is at most one. A second would be a second lock-screen card
         saying almost the same thing, and ActivityKit gives no way to replace
         one atomically — so the running one is found and updated instead, which
         is also what makes this safe to call on every foreground.
         */
        AsyncFunction("showActivity") {
            (day: String, title: String, occurrenceKey: String, remaining: Int, total: Int,
             ink: String?, inkDark: String?) -> Bool in
            guard #available(iOS 16.2, *) else { return false }
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }

            let state = PlanAttributes.ContentState(
                title: title,
                occurrenceKey: occurrenceKey,
                remaining: remaining,
                total: total,
                ink: ink,
                inkDark: inkDark
            )

            /*
             * `staleDate` is what stops a stale card lying. Four hours out, iOS
             * dims the activity to say "this may be out of date" rather than
             * presenting an old chore list as current. The app refreshes it
             * every foreground, so in practice it is only reached by a phone
             * left alone — exactly when the dimming is right.
             */
            let content = ActivityContent(
                state: state,
                staleDate: Date().addingTimeInterval(4 * 60 * 60)
            )

            /*
             * An activity whose `day` differs is yesterday's. Ending it is the
             * point: iOS keeps one alive for up to eight hours, which spans a
             * day break, and a card headed with the wrong day is worse than no
             * card.
             *
             * The whole array is walked, with a flag — not `return`ed from on
             * the first match. `Activity.activities` has no documented
             * ordering, so returning early left yesterday's card up whenever it
             * happened to sort second: the exact thing this loop exists to
             * prevent, working or not depending on array order.
             */
            var updated = false
            for activity in Activity<PlanAttributes>.activities {
                if activity.attributes.day == day, !updated {
                    await activity.update(content)
                    updated = true
                } else {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
            if updated { return true }

            do {
                _ = try Activity.request(
                    attributes: PlanAttributes(day: day),
                    content: content,
                    pushType: nil
                )
                return true
            } catch {
                /*
                 * Thrown when the user has denied activities, or when the app is
                 * in the background — iOS only lets a foreground app start one.
                 * Both are ordinary, so neither is an error worth surfacing.
                 */
                return false
            }
        }

        /// Ends every running activity. Called when the plan is finished, and
        /// when the day rolls over.
        AsyncFunction("endActivities") { () -> Bool in
            guard #available(iOS 16.2, *) else { return false }
            for activity in Activity<PlanAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            return true
        }
    }
}
