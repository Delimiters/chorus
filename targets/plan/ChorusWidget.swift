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
/// The box is a `Button` running an App Intent, so the tap lands without
/// opening the app. On iOS 16 the button simply is not offered — a widget that
/// looks tappable and is not is worse than one that is plainly a display.
///
/// **A finished row is not a button either**, for the same reason. It used to
/// be: tapping a filled box enqueued a key the app then skipped, so the tap
/// did nothing and said nothing. Worse for a *skipped* row — the projection
/// counts skipped as done, so the box was filled, and the drain's only guard
/// was against `completed`: tapping it completed a chore you had deliberately
/// skipped.
///
/// **The tap region is 44pt wide and the full height of the row**, against a
/// 20pt box. `MIN_TARGET` is 44 and this is the project's most repeated
/// failure (see `src/design/tapTargets.test.ts`, which cannot see Swift). A
/// widget row is 22pt tall because a small widget is ~155pt and has to hold a
/// header and three rows, so 44×44 is physically impossible here — but the
/// *width* is free, and the consequence of a mis-tap is worse than in the app:
/// it completes the wrong chore, with no undo anywhere on the home screen, and
/// an interval chore's next due date moves.
struct PlanRow: View {
    let row: Snapshot.Row
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(inkColor(row.ink, row.inkDark, scheme))
                .frame(width: 3)

            if #available(iOS 17.0, *), !row.done {
                Button(intent: TickIntent(occurrenceKey: row.id)) {
                    box
                        .frame(width: 44, height: 22)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Mark \(row.title) done")
            } else {
                box
                    .frame(width: 44, height: 22)
                    .accessibilityLabel(row.done ? "\(row.title), done" : row.title)
            }

            Text(row.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(row.done ? Color.faint : Color.ink)
                .strikethrough(row.done, color: .faint)
                .lineLimit(1)

            Spacer(minLength: 0)
        }
        .frame(height: 22)
    }

    private var box: some View {
        RoundedRectangle(cornerRadius: 5)
            .strokeBorder(row.done ? Color.ink : Color.faint, lineWidth: 1.6)
            .background(
                RoundedRectangle(cornerRadius: 5).fill(row.done ? Color.ink : .clear)
            )
            .frame(width: 20, height: 20)
            // The visual size. The tap region is set by the caller, which is
            // wider than this on purpose.
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
 */
@main
struct ChorusWidgetBundle: WidgetBundle {
    var body: some Widget {
        ChorusWidget()
        if #available(iOS 16.2, *) {
            PlanActivity()
        }
    }
}

struct ChorusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ChorusWidget", provider: PlanProvider()) { entry in
            ChorusWidgetView(entry: entry)
        }
        .configurationDisplayName("Your day")
        .description("What is left on today's plan. Tap a box to tick it off.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
