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
private extension Color {
    static let paper = Color("$paper")
    static let ink = Color("$text")
    static let faint = Color("$textFaint")
    static let overprint = Color("$overprint")
}

private func inkColor(_ hex: String?) -> Color {
    guard let hex, hex.count == 7, hex.hasPrefix("#") else { return .overprint }
    var value: UInt64 = 0
    Scanner(string: String(hex.dropFirst())).scanHexInt64(&value)
    return Color(
        red: Double((value & 0xFF0000) >> 16) / 255,
        green: Double((value & 0x00FF00) >> 8) / 255,
        blue: Double(value & 0x0000FF) / 255
    )
}

// MARK: - Views

/// One row: the ink stripe, the box, the title.
///
/// The box is a `Button` running an App Intent, so the tap lands without
/// opening the app. On iOS 16 the button simply is not offered — a widget that
/// looks tappable and is not is worse than one that is plainly a display.
struct PlanRow: View {
    let row: Snapshot.Row

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(inkColor(row.ink))
                .frame(width: 3)

            if #available(iOS 17.0, *) {
                Button(intent: TickIntent(occurrenceKey: row.id)) {
                    box
                }
                .buttonStyle(.plain)
                .accessibilityLabel(row.done ? "\(row.title), done" : "Mark \(row.title) done")
            } else {
                box
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

@main
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
