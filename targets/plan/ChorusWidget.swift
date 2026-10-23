import SwiftUI
import WidgetKit

// MARK: - Timeline

struct PlanEntry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
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
        PlanEntry(date: Date(), snapshot: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (PlanEntry) -> Void) {
        completion(PlanEntry(date: Date(), snapshot: Snapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PlanEntry>) -> Void) {
        let entry = PlanEntry(date: Date(), snapshot: Snapshot.load())
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
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
/// **The whole row is the button**, not just the box. Three reasons, in order
/// of how much they cost to learn:
///
/// 1. `MIN_TARGET` is 44 and a 20pt box is less than half that. This is the
///    project's most repeated failure, and `src/design/tapTargets.test.ts`
///    cannot see Swift. A mis-tap here is worse than in the app: it completes
///    the *wrong* chore, with no undo anywhere on the home screen, and an
///    interval chore's next due date moves.
/// 2. Padding the box to 44pt instead — the first attempt — took 24pt out of a
///    small widget's ~130pt content width, cutting the title from about
///    thirteen characters to eight. Silently, because the title is
///    `lineLimit(1)`. The row is free; the box is not.
/// 3. A row that is entirely tappable needs no affordance explaining which
///    part of it to hit.
///
/// A finished row is not a button at all. It used to be: tapping a filled box
/// enqueued a key the app then skipped, so the tap did nothing and said
/// nothing. Worse for a *skipped* row — the projection counts skipped as done,
/// so the box was filled, and the drain's only guard was against `completed`:
/// tapping it completed a chore you had deliberately skipped.
struct PlanRow: View {
    let row: Snapshot.Row
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        if row.done {
            content.accessibilityLabel("\(row.title), done")
        } else {
            Button(intent: TickIntent(occurrenceKey: row.id)) {
                content
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Mark \(row.title) done")
        }
    }

    private var content: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(inkColor(row.ink, row.inkDark, scheme))
                .frame(width: 3)

            box

            Text(row.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(row.done ? Color.faint : Color.ink)
                .strikethrough(row.done, color: .faint)
                .lineLimit(1)

            Spacer(minLength: 0)
        }
        .frame(height: 22)
        // The row's own area is the hit region, which is wider than 44pt at
        // every widget size and needs no padding to get there.
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

struct ChorusWidgetView: View {
    let entry: PlanEntry
    @Environment(\.widgetFamily) private var family

    private var visibleRows: Int { family == .systemLarge ? 7 : 3 }

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
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(snapshot.rows.prefix(visibleRows)) { row in
                            PlanRow(row: row)
                        }
                    }
                    Spacer(minLength: 0)
                    if snapshot.rows.count > visibleRows {
                        Text("+\(snapshot.rows.count - visibleRows) more")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.faint)
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
