/**
 * The app and the widget are two processes that never share a type.
 *
 * JavaScript writes the snapshot; Swift reads it. JavaScript starts the Live
 * Activity; Swift renders it. Nothing in either toolchain checks that the two
 * agree about a single field name — and when they disagree, Swift's
 * `try? JSONDecoder().decode(…)` returns nil and the widget silently shows its
 * "never been told" state forever. No crash, no log, nothing to find.
 *
 * So these read the Swift source and compare. Not elegant; it is the only thing
 * standing between a renamed field and a widget that quietly stops working.
 * Same approach as `src/core/text/limits.test.ts`, which reads the DDL.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { widgetSnapshot, type WidgetSnapshot } from './snapshot';

const repo = join(__dirname, '..', '..', '..');
const read = (...parts: readonly string[]) => readFileSync(join(repo, ...parts), 'utf8');

/**
 * Swift with its comments removed.
 *
 * Needed because the comments *describe* the mistakes being guarded against,
 * by name. A test looking for `dateDecodingStrategy` in the source found it in
 * the paragraph explaining why it is not there any more — the same trap as
 * `limits.test.ts`, where an English sentence mentioning another table made a
 * DDL search read the wrong one.
 */
const code = (...parts: readonly string[]) =>
  read(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const WIDGET_SNAPSHOT = 'targets/plan/Snapshot.swift';
const WIDGET_TICK = 'targets/plan/TickIntent.swift';
const WIDGET_ATTRIBUTES = 'targets/plan/PlanActivityAttributes.swift';
const MODULE = 'modules/widget-bridge/ios/WidgetBridgeModule.swift';
const MODULE_ATTRIBUTES = 'modules/widget-bridge/ios/PlanActivityAttributes.swift';

/**
 * Swift property names declared in a `struct`, in source order.
 *
 * Deliberately crude — it reads `let x:` and `var x:` lines and nothing else.
 * A parser would be the wrong trade here: the thing being guarded is a list of
 * eight names, and a regex that fails loudly beats a parser that handles Swift
 * generics.
 */
const propertiesOf = (source: string, structName: string): readonly string[] => {
  const start = source.indexOf(`struct ${structName}`);
  if (start < 0) throw new Error(`no struct ${structName} in that file`);

  const open = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`unbalanced braces reading ${structName}`);

  const body = source.slice(open, end);
  // Skip anything inside a nested struct: `Snapshot.Row` is checked separately.
  const withoutNested = body.replace(/(public )?struct \w+[^{]*\{[\s\S]*?\n {4}\}/g, '');

  return [...withoutNested.matchAll(/^\s*(?:let|var) (\w+):/gm)].map((m) => m[1] as string);
};

/**
 * Swift property names *and their declared types*, in source order.
 *
 * Names alone were not enough, and the gap was not hypothetical: `writtenAt`
 * was declared `Date` with `dateDecodingStrategy = .iso8601`, while JavaScript
 * sends `new Date().toISOString()` — which always carries three fractional
 * digits. Foundation's `.iso8601` has no `.withFractionalSeconds`, so it
 * rejected *every* snapshot, `load()` returned nil forever, and the widget
 * showed "Open Chorus" permanently with nothing logged on either side. The
 * field names matched perfectly throughout.
 */
const typesOf = (source: string, structName: string): Readonly<Record<string, string>> => {
  const start = source.indexOf(`struct ${structName}`);
  if (start < 0) throw new Error(`no struct ${structName} in that file`);

  const open = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(open, end);
  const withoutNested = body.replace(/(public )?struct \w+[^{]*\{[\s\S]*?\n {4}\}/g, '');

  const types: Record<string, string> = {};
  for (const match of withoutNested.matchAll(/^\s*(?:let|var) (\w+): *([\w?[\].]+)/gm)) {
    types[match[1] as string] = match[2] as string;
  }
  return types;
};

describe('the snapshot the widget reads', () => {
  const swift = read(WIDGET_SNAPSHOT);

  it('declares exactly the fields this module writes', () => {
    const sample: WidgetSnapshot = widgetSnapshot([], '2026-10-22' as never, {}, 'now');

    expect(propertiesOf(swift, 'Snapshot')).toEqual(Object.keys(sample));
  });

  it('declares exactly the row fields this module writes', () => {
    const sample = widgetSnapshot(
      [
        {
          position: 1,
          item: {
            occurrenceKey: 'k',
            choreTitle: 't',
            status: 'due',
            assignee: { kind: 'anyone' },
          } as never,
        },
      ],
      '2026-10-22' as never,
      {},
      'now',
    );

    expect(propertiesOf(swift, 'Row')).toEqual(Object.keys(sample.rows[0] as object));
  });

  it('types every field the way JSON actually arrives', () => {
    /*
     * Every one of these is `String`, `Int`, `Bool` or an array of them —
     * nothing that needs a decoding strategy. A `Date` here is the specific
     * failure described on `typesOf` above: it type-checks on both sides, the
     * field names agree, and the whole document silently fails to decode.
     */
    expect(typesOf(swift, 'Snapshot')).toEqual({
      day: 'String',
      doneCount: 'Int',
      totalCount: 'Int',
      rows: '[Row]',
      writtenAt: 'String',
    });

    expect(typesOf(swift, 'Row')).toEqual({
      id: 'String',
      title: 'String',
      done: 'Bool',
      ink: 'String?',
      inkDark: 'String?',
    });
  });

  it('asks for no decoding strategy, because there is nothing to decode', () => {
    /*
     * Belt and braces with the type check above: a strategy appearing here is
     * the clue that somebody reintroduced a `Date`.
     */
    const withoutComments = code(WIDGET_SNAPSHOT);
    expect(withoutComments).not.toContain('dateDecodingStrategy');
    expect(withoutComments).not.toContain('dateEncodingStrategy');
  });

  it('reads the file the module writes, from the group the module uses', () => {
    /*
     * The literals, not the variable names. An app writing
     * plan-snapshot.json into one container while the widget reads
     * plan.json from another is the failure this exists for, and both
     * sides would be individually correct.
     */
    const bridge = read(MODULE);
    for (const literal of ['"group.com.delimiters.chorus"', '"plan-snapshot.json"']) {
      expect(swift).toContain(literal);
      expect(bridge).toContain(literal);
    }
  });

  it('drains the same queue the home-screen tick writes', () => {
    expect(read(WIDGET_TICK)).toContain('"pendingTicks"');
    expect(read(MODULE)).toContain('"pendingTicks"');
  });

  it('reads and acknowledges ticks separately, never in one destructive call', () => {
    /*
     * One call that returned the queue *and* cleared it lost ticks twice over:
     * on a cold start every key looked up nothing and was dropped as archived,
     * and offline the completion rejected with nothing left to retry. The
     * protocol is read, write, then forget.
     */
    const bridge = read(MODULE);
    expect(bridge).toContain('Function("pendingTicks")');
    expect(bridge).toContain('Function("acknowledgeTicks")');
    expect(code(MODULE)).not.toContain('takePendingTicks');
  });
});

describe('the Live Activity attributes', () => {
  it('are byte-identical in the app and the extension', () => {
    /*
     * ActivityKit routes an activity to its configuration by the *name* of the
     * attributes type and decodes the other process's ContentState. Two copies
     * that differ produce an activity that starts and renders the system
     * placeholder, reporting nothing anywhere.
     */
    expect(read(MODULE_ATTRIBUTES)).toBe(read(WIDGET_ATTRIBUTES));
  });

  it('declare exactly the state the bridge sends', () => {
    /*
     * The bridge's `showActivity` names its arguments; ContentState names its
     * fields. These are two separate lists in two files and nothing but this
     * makes them agree.
     */
    const state = propertiesOf(read(WIDGET_ATTRIBUTES), 'ContentState');
    const call = read(MODULE).match(/AsyncFunction\("showActivity"\)[\s\S]*?->/);
    expect(call).not.toBeNull();

    /*
     * Exact and ordered, not "contains each". `src/data/widget.ts` passes
     * these positionally, so an argument inserted in the middle of the Swift
     * signature would shift every one after it — and a one-directional
     * "does the signature mention each field" check passes happily through
     * that.
     */
    const args = [...(call?.[0] ?? '').matchAll(/(\w+): [\w?[\]]+/g)].map((m) => m[1] as string);
    expect(args).toEqual(['day', ...state]);
    expect(state).toEqual(['title', 'occurrenceKey', 'remaining', 'total', 'ink', 'inkDark']);
  });
});
