import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// The persistent card: lock screen, and the Dynamic Island when the phone has
/// one.
///
/// Why this and not more notifications. A reminder is an event — it arrives,
/// and then it is in a list you have to go and look at. "Keep asking until it
/// is done" is a *state*, and a Live Activity is the only thing iOS gives a
/// third-party app that holds one: it stays on the lock screen, it carries a
/// button that completes the chore without opening the app, and it does not
/// stack up six copies of itself the way the nag ladder necessarily does.
///
/// It is not a replacement for the ladder. The app can only *start* one while
/// it is in the foreground, so a chore that comes due while Chorus is closed
/// still needs the notification to get your attention. The ladder gets you to
/// look; this is what you see when you do, and what you tick.



/// The tick button, shared by every presentation.
///
/// `TickIntent` is the same one the home-screen widget uses, so a tick from the
/// lock screen and a tick from the widget land in the same queue and are
/// replayed through the same completion path. Two buttons, one mechanism.
private struct ActivityTickButton: View {
    let occurrenceKey: String
    let title: String
    var compact = false

    var body: some View {
        /*
         * No `#available` check. This target's floor is iOS 18.0, so the
         * interactive-button branch is the only reachable one — and a
         * conditional in a Live Activity view is how the whole card ended up
         * rendering as the system's blank placeholder once already. See the
         * note on `ChorusWidgetBundle`.
         */
        Button(intent: TickIntent(occurrenceKey: occurrenceKey)) {
            label
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Mark \(title) done")
    }

    private var label: some View {
        RoundedRectangle(cornerRadius: compact ? 4 : 6)
            .strokeBorder(Color.faint, lineWidth: 1.6)
            .frame(width: compact ? 18 : 28, height: compact ? 18 : 28)
            .overlay(
                Image(systemName: "checkmark")
                    .font(.system(size: compact ? 9 : 13, weight: .bold))
                    .foregroundStyle(Color.faint)
            )
            /*
             * 44×44 on the lock-screen card, which is `MIN_TARGET` — the one
             * surface here with the room for it, and one where a mis-tap
             * completes the wrong chore with no undo in reach. The Dynamic
             * Island passes `compact` and gets 28pt, because its regions flank
             * the sensor housing.
             */
            .frame(width: compact ? 28 : 44, height: compact ? 28 : 44)
            .contentShape(Rectangle())
    }
}

struct PlanActivityView: View {
    let state: PlanAttributes.ContentState
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2)
                .fill(inkColor(state.ink, state.inkDark, scheme))
                .frame(width: 4, height: 36)

            VStack(alignment: .leading, spacing: 2) {
                Text(state.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.ink)
                    .lineLimit(1)
                Text(remainingLabel)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.faint)
            }

            Spacer(minLength: 0)

            ActivityTickButton(occurrenceKey: state.occurrenceKey, title: state.title)
        }
        .padding(14)
        .activityBackgroundTint(Color.paper)
        .activitySystemActionForegroundColor(Color.ink)
    }

    /*
     * "1 left" rather than "1 of 5 left", and never "0 left": the activity ends
     * when the plan is finished, so a zero here would mean the app failed to
     * end it — words that describe a state that should not exist are how a
     * display starts lying.
     */
    private var remainingLabel: String {
        /*
         * No zero case. `activityState` returns nil whenever no outstanding
         * chore has asked to insist — which covers an empty plan, a finished
         * one, and an ordinary day — and the app ends the card then rather
         * than updating it, so
         * `total == 0` cannot reach here, and a branch written for it would be
         * untested words describing a state that must not exist.
         */
        let done = max(0, state.total - state.remaining)
        return "\(done) of \(state.total) done · \(state.remaining) left"
    }
}

struct PlanActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PlanAttributes.self) { context in
            PlanActivityView(state: context.state)
        } dynamicIsland: { context in
            /*
             * `.dark` is hard-coded throughout the island, and correctly: it is
             * always drawn on the black of the sensor housing, whatever the
             * viewer's theme. The lock-screen card above reads the real scheme.
             */
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(inkColor(context.state.ink, context.state.inkDark, .dark))
                        .frame(width: 4, height: 28)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(context.state.title)
                            .font(.system(size: 15, weight: .semibold))
                            .lineLimit(1)
                        Text("\(context.state.remaining) left today")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    /*
                     * `compact`, so the target is 28pt rather than 44pt.
                     * The expanded island's leading and trailing regions flank
                     * the sensor housing, which is about 37pt wide, and Apple
                     * is explicit that content there should stay minimal — a
                     * 44pt frame either pushes the top row taller or gets
                     * clipped. The lock-screen card below has the room and
                     * uses the full target.
                     */
                    ActivityTickButton(
                        occurrenceKey: context.state.occurrenceKey,
                        title: context.state.title,
                        compact: true
                    )
                }
            } compactLeading: {
                Image(systemName: "checklist")
                    .foregroundStyle(inkColor(context.state.ink, context.state.inkDark, .dark))
            } compactTrailing: {
                Text("\(context.state.remaining)")
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
            } minimal: {
                Text("\(context.state.remaining)")
                    .font(.system(size: 12, weight: .semibold))
                    .monospacedDigit()
            }
        }
    }
}
