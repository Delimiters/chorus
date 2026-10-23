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

    for (const field of state) {
      expect(call?.[0]).toContain(`${field}:`);
    }
    expect(state).toEqual(['title', 'occurrenceKey', 'remaining', 'total', 'ink', 'inkDark']);
  });
});
