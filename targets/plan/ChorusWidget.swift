import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Timeline

struct PlanEntry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
    /**
     A finished row to keep showing anyway, because it was just tapped.

     Nil in every entry but the first one after a tap. Two entries come back
     from `getTimeline` in that case — this one now, and one without it at the
     moment the hold expires — so the row stays put for ten seconds and then
     steps aside with no reload spent: WidgetKit pre-renders future entries.
     */
    let holding: String?
}

/// When the widget asks itself what to show.
///
/// Two mechanisms, and both matter. The app calls `reloadAllTimelines()`
/// whenever its own data changes, which is free and immediate while the app is
/// open. For everything else — the other phone ticking something, the day
/// rolling over — the timeline asks again on its own. iOS budgets that to
/// roughly 40–70 reloads a day, so a short interval buys nothing: asking every
/// five minutes would exhaust the budget before lunch and leave the widget
/// stale all evening. Half an hour is inside the budget and inside the useful
/// resolution of a chore list.
struct PlanProvider: TimelineProvider {
    func placeholder(in context: Context) -> PlanEntry {
        PlanEntry(date: Date(), snapshot: nil, holding: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (PlanEntry) -> Void) {
        completion(PlanEntry(date: Date(), snapshot: Snapshot.load(), holding: nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PlanEntry>) -> Void) {
        let now = Date()
        let snapshot = Snapshot.load()
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: now) ?? now

        /*
         * Two entries when something was just tapped, one otherwise.
         *
         * This is the whole mechanism for "the row steps aside after ten
         * seconds", and it costs nothing: WidgetKit renders future entries at
         * their dates without calling back, so the budget of roughly 40–70
         * reloads a day is untouched. A timer or a short reload interval would
         * have spent that budget by lunchtime — see the note on this type.
         *
         * `holding` is dropped in the second entry rather than the snapshot
         * being rewritten, so nothing about the day has to change for the row
         * to leave.
         */
        guard let held = RecentTap.current(now: now) else {
            completion(
                Timeline(
                    entries: [PlanEntry(date: now, snapshot: snapshot, holding: nil)],
                    policy: .after(next)
                )
            )
            return
        }

        completion(
            Timeline(
                entries: [
                    PlanEntry(date: now, snapshot: snapshot, holding: held.key),
                    PlanEntry(date: held.until, snapshot: snapshot, holding: nil),
                ],
                policy: .after(next)
            )
        )
    }
}

// MARK: - Palette

/// The app's tokens, as the widget needs them.
///
/// Named colours come from the asset catalogue the target config generates, so
/// light and dark are handled by the system rather than by a branch here — and
/// so changing an ink in `expo-target.config.js` changes it in one place.
extension Color {
    static let paper = Color("$paper")
    static let ink = Color("$text")
    static let faint = Color("$textFaint")
    static let overprint = Color("$overprint")
}

/// Parses `#RRGGBB`. Returns nil on anything else rather than guessing, so a
/// malformed value falls back to the overprint instead of rendering black.
func parseHex(_ hex: String?) -> Color? {
    guard let hex, hex.count == 7, hex.hasPrefix("#") else { return nil }
    var value: UInt64 = 0
    guard Scanner(string: String(hex.dropFirst())).scanHexInt64(&value) else { return nil }
    return Color(
        red: Double((value & 0xFF0000) >> 16) / 255,
        green: Double((value & 0x00FF00) >> 8) / 255,
        blue: Double(value & 0x0000FF) / 255
    )
}

/// Whoever's ink, on the ground this widget is actually being drawn on.
///
/// Both hexes come from the snapshot because the app cannot know the viewer's
/// theme — and `src/design/inks.ts` is explicit that the dark variant is
/// hand-lifted rather than derived, so darkening the light one here would undo
/// the only reason the palette is curated.
func inkColor(_ light: String?, _ dark: String?, _ scheme: ColorScheme) -> Color {
    let chosen = scheme == .dark ? (dark ?? light) : light
    return parseHex(chosen) ?? .overprint
}

// MARK: - Views

/// One row: the ink stripe, the box, the title.
///
/// ## What is tappable, and what that cost to get right
///
/// **The box ticks. The title opens the app.** Two taps with different
/// consequences, and the one that changes data is the smaller of them.
///
/// It was the whole row for two builds, which fixed one problem and caused a
/// worse one. Emily, on build 79:
///
/// > "on the widget it's too easy to accidentally check a row, and then when
/// > she tried to uncheck that one she was accidentally checking other things"
///
/// Both halves are the same mistake. A 22pt-tall, full-width live target on a
/// home screen you also swipe and long-press is easy to hit by accident; and
/// **a finished row was deliberately not a button**, on the reasoning that a
/// filled box which does nothing is a lie. True in isolation, and together
/// they left an accidental tick with no way back except tapping at it again,
/// which hit the rows either side.
///
/// So: a finished row is a button too, running `UntickIntent`. Recoverability
/// first — the app has had an undo toast since Emily's *"i accidentally checked
/// something off and it disappeared 😭"*, and the home screen needed the same
/// thing rather than only a narrower target.
///
/// The tick region is 44pt wide — `MIN_TARGET` — and the full height of the
/// row, which is as much as a 22pt row can give; `src/design/tapTargets.test.ts`
/// cannot see Swift, so this is the note that says so. That costs 24pt of a
/// small widget's ~130pt content width, which is the reason the whole row was
/// tried instead: the title drops from about thirteen characters to eight.
/// Measured against an accidental completion of the *wrong* chore, eight
/// characters is the better trade — and the title is still the larger half of
/// the row, so the safe thing to tap is also the easiest.
struct PlanRow: View {
    let row: Snapshot.Row
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(inkColor(row.ink, row.inkDark, scheme))
                .frame(width: 3)

            /*
             * Both directions, from the same place.
             *
             * `TickIntent` and `UntickIntent` write to two queues, and each
             * withdraws the key from the other — so tapping twice before the
             * app next opens leaves the later intention queued rather than one
             * of each.
             */
            if row.done {
                Button(intent: UntickIntent(occurrenceKey: row.id)) {
                    target
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(row.title), done. Take it back")
            } else {
                Button(intent: TickIntent(occurrenceKey: row.id)) {
                    target
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Mark \(row.title) done")
            }

            /*
             * Inert, so it falls through to opening the app.
             *
             * This is the half of the row that is safe to touch, and it is
             * most of it. Without something inert there is nowhere on a small
             * widget's face to tap that does not change data.
             */
            Text(row.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(row.done ? Color.faint : Color.ink)
                .strikethrough(row.done, color: .faint)
                .lineLimit(1)

            Spacer(minLength: 0)
        }
        .frame(height: 22)
    }

    /// The box, inside a target big enough to mean it.
    ///
    /// `.leading`, so the extra width goes to the right of the box rather than
    /// being split either side. Centred, the 20pt box sat 12pt off the ink
    /// stripe and pushed the title 24pt right — paying twice for the same
    /// 44pt on a widget already short of title room.
    private var target: some View {
        box
            .frame(width: 44, height: 22, alignment: .leading)
            .contentShape(Rectangle())
    }

    private var box: some View {
        RoundedRectangle(cornerRadius: 5)
            .strokeBorder(row.done ? Color.ink : Color.faint, lineWidth: 1.6)
            .background(
                RoundedRectangle(cornerRadius: 5).fill(row.done ? Color.ink : .clear)
            )
            .frame(width: 20, height: 20)
            // The visual size only. The hit region is the whole row.
            .overlay(
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color.paper)
                    .opacity(row.done ? 1 : 0)
            )
    }
}

/// One row's own height, and the gap drawn under it.
private let rowHeight: CGFloat = 22
private let rowGap: CGFloat = 6
/// What a row occupies when something follows it.
private let rowPitch: CGFloat = rowHeight + rowGap
/// The "+N more" line: SF 12pt, whose line height is a shade over fourteen.
private let footerHeight: CGFloat = 15

struct ChorusWidgetView: View {
    let entry: PlanEntry

    /**
     How many rows actually fit, measured rather than guessed.

     It was `family == .systemLarge ? 7 : 3`, which left a large widget with
     about three rows' worth of empty space under the list. Jake: *"The widget
     also has a lot of blank space at the bottom for some reason even though
     there's more room for tasks."*

     Two numbers cannot be right across three families and every screen size
     Apple ships, and the failure is silent in both directions — too few wastes
     the space, too many clips the last row. `GeometryReader` gives the real
     height, so this is arithmetic instead of a guess: subtract the "+N more"
     line's own pitch so it never gets pushed off by the rows it describes, and
     keep at least one row so a very short container still shows something.
     */
    private func visibleRows(in height: CGFloat, total: Int) -> Int {
        /*
         * `rowPitch` counts a row *and* the gap under it, so n rows occupy
         * `n * rowPitch - rowGap` — there is no gap after the last one. The
         * first version divided by the pitch without adding that gap back,
         * and so lost a row whenever the remainder was at least `rowHeight`.
         */
        let withoutFooter = Int(((height + rowGap) / rowPitch).rounded(.down))
        if withoutFooter >= total { return max(1, withoutFooter) }

        /*
         * Room for the "+N more" line, which needs its own height plus the gap
         * above it — not a whole row's pitch, which is what the first version
         * reserved. Over-reserving cost a second row, so a small widget showed
         * two where three fit: fewer rows than the hard-coded number this
         * replaced, while fixing a complaint about empty space.
         */
        let forRows = height + rowGap - (footerHeight + rowGap)
        return max(1, Int((forRows / rowPitch).rounded(.down)))
    }

    /**
     The rows worth a slot: what is left, plus whatever was just tapped.

     A finished row is **not** shown. Jake: *"once you check something it just
     stays on there indefinitely rather than being eventually replaced by
     another task"* — and the previous answer, sinking them to the bottom,
     only replaced them once there was enough outstanding work to push them
     off. On a three-row widget with four things to do, a chore ticked at
     breakfast still held a third of the face all day.

     The header keeps saying "2 of 5", so nothing is hidden about the day; the
     *list* is just about what remains, which is what a three-row window is
     good for.

     The exception is the row under your finger. Hiding it the instant it is
     ticked would take the undo with it — and an accidental tick that cannot be
     undone is the whole complaint this started from.

     No ordering happens here. The app writes the rows outstanding-first, so
     dropping the finished ones leaves the next ones in the order it chose; a
     second copy of that rule in Swift is the drift `POSTMORTEM-SWIFT.md` is
     about.
     */
    private func candidates(_ snapshot: Snapshot) -> [Snapshot.Row] {
        snapshot.rows.filter { !$0.done || $0.id == entry.holding }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let snapshot = entry.snapshot {
                header(snapshot)

                if snapshot.rows.isEmpty {
                    Spacer()
                    Text("Nothing left today.")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.ink)
                    Spacer()
                } else if candidates(snapshot).isEmpty {
                    /*
                     * Everything on the plan is finished. The header already
                     * says "5 of 5", so this is the same state as an empty
                     * plan from the widget's point of view — what is left is
                     * nothing — and it should read as the achievement rather
                     * than as a blank list.
                     */
                    Spacer()
                    Text("All done today.")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.ink)
                    Spacer()
                } else {
                    let rows = candidates(snapshot)
                    GeometryReader { geometry in
                        let shown = visibleRows(in: geometry.size.height, total: rows.count)
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(rows.prefix(shown)) { row in
                                PlanRow(row: row)
                            }
                            if rows.count > shown {
                                Text("+\(rows.count - shown) more")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Color.faint)
                            }
                            Spacer(minLength: 0)
                        }
                    }
                }
            } else {
                // Never been told, as opposed to nothing to do. Different state,
                // different words — a widget claiming an empty day it has not
                // been given would be lying confidently.
                Text("Open Chorus")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.ink)
                Text("to set up your day here")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.faint)
            }
        }
        .containerBackground(Color.paper, for: .widget)
    }

    private func header(_ snapshot: Snapshot) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("TODAY")
                .font(.system(size: 10, weight: .semibold))
                .kerning(1.2)
                .foregroundStyle(Color.faint)
            Spacer()
            Text("\(snapshot.doneCount) of \(snapshot.totalCount)")
                .font(.system(size: 12, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(Color.faint)
        }
    }
}

// MARK: - Widget

/**
 Both things this extension serves.

 A widget extension hosts every WidgetKit surface an app has, and a Live
 Activity is one — `PlanActivity` is in `PlanActivity.swift`. So `@main` moves
 to the bundle: two `@main` declarations in one target do not compile, and the
 bundle is the only place that can own it.

 ## Nothing here is wrapped in `if #available`, and that is load-bearing

 It was. `PlanActivity()` sat inside `if #available(iOS 16.2, *)`, which
 compiles — `WidgetBundleBuilder.buildOptional` accepts an availability clause —
 by wrapping the widget in SwiftUI's type-erased `LimitedAvailabilityWidget`.
 That erasure is what the system has to look through to find the
 `ActivityConfiguration` matching a running activity's attributes, and it did
 not find it: the app started the activity, iOS showed its container with the
 app's name and no content in it, and nothing was logged. Jake, on build 66:
 *"a semi transparent notification that said chorus but had nothing on it"*.

 The guard bought nothing either way. This target's deployment target is **iOS
 18.0** — see `IPHONEOS_DEPLOYMENT_TARGET` in the generated project — so no
 availability check below that can ever be false here. `PlanAttributes` keeps
 its `@available(iOS 16.2, *)` because that file is compiled into the *app*
 too, whose floor is 15.1.

 `src/core/widget/contract.test.ts` fails if a conditional reappears in this
 bundle.
 */
@main
struct ChorusWidgetBundle: WidgetBundle {
    var body: some Widget {
        ChorusWidget()
        PlanActivity()
    }
}

struct ChorusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ChorusWidget", provider: PlanProvider()) { entry in
            ChorusWidgetView(entry: entry)
        }
        .configurationDisplayName("Your day")
        .description("What is left on today's plan. Tap a row to tick it off.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
