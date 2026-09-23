/*
 * The Upcoming tab, which is now the annotated chores list.
 *
 * It held a month calendar that Jake never used — *"I currently do not use that
 * calendar view at all for anything, it's like not even useful to me."* The
 * list that was Today's "Chores" sub-tab lives here instead: checkable rows with
 * their category, lateness, notes and steps, filtered to what is late or due
 * within thirty days, with a toggle to everything — plus a "Someday" section
 * for chores with no date, which sits outside that filter because it has no
 * date to filter on.
 *
 * That last part used to say "or undated" and was simply false: an unscheduled
 * chore expands to no occurrences, so it reached none of these lists. Emily
 * found it by moving the house to no-date chores and watching them vanish.
 *
 * That is the difference from the Chores tab, which is the library: these rows
 * can be ticked off. See docs/DECISIONS.md.
 *
 * Route wrapper. The screen lives in src/features so its test file is not
 * inside the router tree — anything under src/app is treated as a route.
 */
export { TodayScreen as default } from '@/features/today/TodayScreen';
