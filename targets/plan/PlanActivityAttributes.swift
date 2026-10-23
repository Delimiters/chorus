import ActivityKit
import Foundation

/// What the Live Activity shows, and what the app may change while it runs.
///
/// **This file is duplicated, byte for byte, in two places:**
///
///   targets/plan/PlanActivityAttributes.swift            (the widget extension)
///   modules/widget-bridge/ios/PlanActivityAttributes.swift   (the app)
///
/// ActivityKit routes an activity to its `ActivityConfiguration` by the
/// *name* of the attributes type, and the two processes decode each other's
/// `ContentState` — so the app starts one and the extension renders it only
/// while both declarations agree. They cannot be one file: the extension
/// compiles `targets/plan/`, the app compiles the module's pod, and a pod may
/// not reach outside its own directory for sources.
///
/// `src/core/widget/attributes.drift.test.ts` fails if the two copies differ,
/// because the failure mode otherwise is a Live Activity that starts, shows the
/// system's blank placeholder, and reports nothing anywhere.
@available(iOS 16.2, *)
struct PlanAttributes: ActivityAttributes {
    /// The part that changes while the activity is live.
    public struct ContentState: Codable, Hashable {
        /// The chore being asked about.
        var title: String
        /// What the Done button addresses. An occurrence key, not a chore id —
        /// the same chore tomorrow is a different thing to tick.
        var occurrenceKey: String
        /// How many are left on the plan, this one included.
        var remaining: Int
        /// How many the day started with, so the activity can say "2 of 5".
        var total: Int
        /// Hex for whoever it belongs to on the paper ground; nil for shared work.
        var ink: String?
        /// The same ink on the night ground. A Live Activity renders in the
        /// viewer's theme and this process cannot ask which it is.
        var inkDark: String?
    }

    /// Fixed for the life of the activity: the household day it belongs to.
    ///
    /// Not decorative. A Live Activity can outlive the day that started it —
    /// iOS keeps one for up to eight hours — and the app ends and restarts it
    /// at the day break rather than letting yesterday's linger.
    var day: String
}
