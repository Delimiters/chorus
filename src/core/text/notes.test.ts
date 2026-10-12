import { noteBlocks, notePreview, toggleListPrefix, type NoteBlock } from './notes';

/*
 * Narrowed on `kind` rather than cast. A cast here would let a parser that
 * returned the wrong block shape still pass these tests.
 */
const text = (block: NoteBlock): string =>
  block.kind === 'paragraph' ? block.spans.map((s) => s.value).join('') : '';

const items = (block: NoteBlock): string[] =>
  block.kind === 'paragraph'
    ? []
    : block.items.map((i) => `${String(i.number)}:${i.spans.map((s) => s.value).join('')}`);

const spansOf = (block: NoteBlock) => (block.kind === 'paragraph' ? block.spans : []);

describe('a plain note', () => {
  it('is one paragraph', () => {
    const blocks = noteBlocks('Call the vet about Penelope');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph']);
    expect(text(blocks[0]!)).toBe('Call the vet about Penelope');
  });

  it('keeps its own line breaks rather than becoming a block each', () => {
    /*
     * A note's line breaks are information — an address, a list somebody wrote
     * without dashes. One paragraph holding the newlines renders with single
     * spacing; a block per line would double it.
     */
    const blocks = noteBlocks('123 Main St\nApt 4\nAustin TX');
    expect(blocks).toHaveLength(1);
    expect(text(blocks[0]!)).toBe('123 Main St\nApt 4\nAustin TX');
  });

  it('is nothing at all when empty', () => {
    expect(noteBlocks('')).toEqual([]);
    expect(noteBlocks('   \n  \n')).toEqual([]);
  });

  it('still finds its links', () => {
    const blocks = noteBlocks('order from https://example.com/part before Friday');
    const links = spansOf(blocks[0]!).filter((s) => s.kind === 'link');
    expect(links.map((s) => (s.kind === 'link' ? s.href : ''))).toEqual([
      'https://example.com/part',
    ]);
  });
});

describe('bullets', () => {
  it('group consecutive lines into one list', () => {
    const blocks = noteBlocks('- milk\n- eggs\n- bread');
    expect(blocks.map((b) => b.kind)).toEqual(['bullets']);
    expect(items(blocks[0]!)).toEqual(['1:milk', '2:eggs', '3:bread']);
  });

  it('take a dash, an asterisk or a bullet character', () => {
    expect(items(noteBlocks('- a\n* b\n• c')[0]!)).toEqual(['1:a', '2:b', '3:c']);
  });

  it('need the space, so prose stays prose', () => {
    /*
     * "3-4 bags" and "*not* the big one" are things people write in notes.
     * Turning them into bullets would be worse than having no bullets.
     */
    expect(noteBlocks('3-4 bags of pellets').map((b) => b.kind)).toEqual(['paragraph']);
    expect(noteBlocks('*not* the big one').map((b) => b.kind)).toEqual(['paragraph']);
  });

  it('allow an empty one, because that is a list being typed', () => {
    expect(items(noteBlocks('- milk\n-')[0]!)).toEqual(['1:milk', '2:']);
  });

  it('end at a blank line', () => {
    const blocks = noteBlocks('- milk\n\nsomething else');
    expect(blocks.map((b) => b.kind)).toEqual(['bullets', 'paragraph']);
  });

  it('end when prose starts, with no blank line needed', () => {
    const blocks = noteBlocks('- milk\nand also call the vet');
    expect(blocks.map((b) => b.kind)).toEqual(['bullets', 'paragraph']);
    expect(text(blocks[1]!)).toBe('and also call the vet');
  });

  it('carry their own links', () => {
    const blocks = noteBlocks('- order https://example.com/filters');
    const first = blocks[0]!;
    const spans = first.kind === 'bullets' ? first.items[0]!.spans : [];
    expect(spans.some((s) => s.kind === 'link')).toBe(true);
  });
});

describe('numbered lists', () => {
  it('renumber from the first item, so inserting a line is safe', () => {
    // Every editor people have used does this. A list typed 1. 1. 1. reads
    // 1, 2, 3.
    expect(items(noteBlocks('1. first\n1. second\n1. third')[0]!)).toEqual([
      '1:first',
      '2:second',
      '3:third',
    ]);
  });

  it('keep the number the list was started at', () => {
    // A list starting "3." was almost certainly continuing something.
    expect(items(noteBlocks('3. third\n4. fourth')[0]!)).toEqual(['3:third', '4:fourth']);
  });

  it('take a dot or a paren', () => {
    expect(items(noteBlocks('1. a\n2) b')[0]!)).toEqual(['1:a', '2:b']);
  });

  it('leave a year alone', () => {
    // "2026. What a year" is prose, not item two thousand and twenty-six.
    expect(noteBlocks('2026. What a year').map((b) => b.kind)).toEqual(['paragraph']);
  });

  it('are their own block beside bullets, not merged', () => {
    const blocks = noteBlocks('- milk\n1. first');
    expect(blocks.map((b) => b.kind)).toEqual(['bullets', 'numbers']);
  });
});

describe('a note that mixes everything', () => {
  it('comes apart in order', () => {
    const blocks = noteBlocks(
      ['Shopping:', '- milk', '- eggs', '', 'Then, in order:', '1. pharmacy', '2. vet'].join('\n'),
    );

    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'bullets', 'paragraph', 'numbers']);
    expect(text(blocks[0]!)).toBe('Shopping:');
    expect(items(blocks[1]!)).toEqual(['1:milk', '2:eggs']);
    expect(items(blocks[3]!)).toEqual(['1:pharmacy', '2:vet']);
  });

  it('loses nothing: every rendered line is a source line minus its marker', () => {
    /*
     * The invariant, not a word list.
     *
     * This asserted that six hand-written phrases appeared somewhere in one
     * joined blob — which a review showed is blind to order and to duplication:
     * reversing every list's items, or duplicating the last one, left it green.
     * Lines in order, each a suffix of its source line, catches all of that and
     * does not need updating when the fixture grows.
     */
    const note = [
      'Buy:',
      '- milk',
      '* eggs',
      '2) bread',
      'done by 5',
      'see www.example.com',
      '- [ ] water plants ',
      '\t\t○ Bills:',
    ].join('\n');

    const rendered = noteBlocks(note).flatMap((b) =>
      b.kind === 'paragraph'
        ? b.spans
            .map((s) => s.value)
            .join('')
            .split('\n')
        : b.items.map((i) => i.spans.map((s) => s.value).join('')),
    );
    const source = note.split('\n').filter((l) => l.trim() !== '');

    expect(rendered).toHaveLength(source.length);
    rendered.forEach((line, index) => {
      const from = source[index]!;
      // Every character of the rendered line is the tail of its source line…
      expect(from.endsWith(line)).toBe(true);
      // …and all that was eaten is whitespace, a marker, and a checkbox.
      const prefix = from.slice(0, from.length - line.length);
      expect(prefix).toMatch(
        /^[ \t]*(?:[-*•○▪§‣◦⁃–—☐☑☒✓✔✗✘]|\d{1,3}[.)])?[ \t]*(?:\[[ xX]\])?[ \t]*$/,
      );
    });
  });
});

describe('the list buttons', () => {
  const at = (text: string) => text.indexOf('|');
  const run = (withCaret: string, kind: 'bullets' | 'numbers') => {
    const text = withCaret.replace('|', '');
    const out = toggleListPrefix(text, at(withCaret), kind);
    return `${out.text.slice(0, out.cursor)}|${out.text.slice(out.cursor)}`;
  };

  it('makes the current line a bullet', () => {
    expect(run('milk|', 'bullets')).toBe('- milk|');
  });

  it('makes the current line numbered', () => {
    expect(run('milk|', 'numbers')).toBe('1. milk|');
  });

  it('takes the marker off again', () => {
    // Toggling: the same button twice leaves the line as it was.
    expect(run('- milk|', 'bullets')).toBe('milk|');
    expect(run('1. milk|', 'numbers')).toBe('milk|');
  });

  it('swaps one kind for the other rather than stacking them', () => {
    expect(run('- milk|', 'numbers')).toBe('1. milk|');
    expect(run('1. milk|', 'bullets')).toBe('- milk|');
  });

  it('counts on from the list above', () => {
    // Holding the button down a list should count up, not write "1." twice.
    expect(run('1. milk\neggs|', 'numbers')).toBe('1. milk\n2. eggs|');
    expect(run('3. milk\neggs|', 'numbers')).toBe('3. milk\n4. eggs|');
  });

  it('starts again at one after a break', () => {
    expect(run('1. milk\n\neggs|', 'numbers')).toBe('1. milk\n\n1. eggs|');
    expect(run('1. milk\nsomething else\neggs|', 'numbers')).toBe(
      '1. milk\nsomething else\n1. eggs|',
    );
  });

  it('works on the line the caret is on, not the last one', () => {
    expect(run('milk|\neggs', 'bullets')).toBe('- milk|\neggs');
    expect(run('milk\neggs|', 'bullets')).toBe('milk\n- eggs|');
  });

  it('keeps the caret where it was in the word', () => {
    // Pressing a button mid-word must not move the caret elsewhere in the line.
    expect(run('mi|lk', 'bullets')).toBe('- mi|lk');
  });

  it('handles an empty line, which is a list being started', () => {
    expect(run('|', 'bullets')).toBe('- |');
    expect(run('milk\n|', 'numbers')).toBe('milk\n1. |');
  });

  it('cannot be pushed out of the string', () => {
    expect(() => toggleListPrefix('milk', -5, 'bullets')).not.toThrow();
    expect(() => toggleListPrefix('milk', 999, 'bullets')).not.toThrow();
  });
});

describe('a card preview', () => {
  it('takes the markers off', () => {
    // A card reading "- milk" is showing its own syntax.
    expect(notePreview('- milk\n- eggs')).toBe('milk\neggs');
    expect(notePreview('1. pharmacy\n2) vet')).toBe('pharmacy\nvet');
  });

  it('collapses blank lines, which waste a two-line preview', () => {
    expect(notePreview('Shopping:\n\n- milk')).toBe('Shopping:\nmilk');
  });

  it('leaves prose exactly as it is', () => {
    expect(notePreview('3-4 bags of pellets')).toBe('3-4 bags of pellets');
    expect(notePreview('')).toBe('');
  });
});

describe('a note that came from somewhere else', () => {
  it('parses lists pasted with Windows line endings', () => {
    /*
     * `.` in a regex does not match `\r`, so "- milk\r" failed the bullet
     * pattern and a list pasted from a browser rendered as prose.
     */
    const blocks = noteBlocks('- milk\r\n- eggs');
    expect(blocks.map((b) => b.kind)).toEqual(['bullets']);
    expect(items(blocks[0]!)).toEqual(['1:milk', '2:eggs']);
  });

  it('leaves no stray carriage return inside the text', () => {
    // An invisible character in the middle of somebody's note.
    expect(text(noteBlocks('one\r\ntwo')[0]!)).toBe('one\ntwo');
  });

  it('handles an old-Mac lone carriage return too', () => {
    expect(noteBlocks('- milk\r- eggs').map((b) => b.kind)).toEqual(['bullets']);
  });

  it('previews them the same way', () => {
    expect(notePreview('- milk\r\n- eggs')).toBe('milk\neggs');
  });
});

describe('a note nobody would write but somebody will paste', () => {
  it('stays linear on a long note', () => {
    // 5,000 lines, half of them list items. Guards against a quadratic rescan.
    const note = Array.from({ length: 5000 }, (_, i) =>
      i % 2 === 0 ? `- item ${String(i)}` : `prose ${String(i)}`,
    ).join('\n');
    const started = Date.now();
    const blocks = noteBlocks(note);
    expect(blocks.length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('keeps emoji and non-Latin text intact', () => {
    const blocks = noteBlocks('- 🥛 milk\n- 牛乳');
    expect(items(blocks[0]!)).toEqual(['1:🥛 milk', '2:牛乳']);
  });

  it('treats a line of only whitespace between items as a break', () => {
    const blocks = noteBlocks('- milk\n   \n- eggs');
    expect(blocks.map((b) => b.kind)).toEqual(['bullets', 'bullets']);
  });

  it('survives a note that is only markers', () => {
    expect(items(noteBlocks('-\n-\n-')[0]!)).toEqual(['1:', '2:', '3:']);
    expect(items(noteBlocks('1.\n2.')[0]!)).toEqual(['1:', '2:']);
  });

  it('keeps tabs working as the space after a marker', () => {
    expect(items(noteBlocks('-\tmilk')[0]!)).toEqual(['1:milk']);
  });
});

describe('a checklist pasted from another app', () => {
  /*
   * Jake: *"It would be cool if when you pasted something in from ios notes it
   * kind of intelligently turned the checklist markup that copies over into
   * bullet points."* Copying a checklist out of Notes brings the boxes with it
   * as the marker; copying a plain list brings `◦` or a dash.
   */
  const boxes = (block: NoteBlock) =>
    block.kind === 'paragraph' ? [] : block.items.map((i) => i.checked);

  it('reads ballot boxes as checklist items', () => {
    const blocks = noteBlocks('☐ wash blankets\n☑ hand towels');
    expect(blocks.map((b) => b.kind)).toEqual(['bullets']);
    expect(items(blocks[0]!)).toEqual(['1:wash blankets', '2:hand towels']);
    expect(boxes(blocks[0]!)).toEqual([false, true]);
  });

  it('reads check marks as done', () => {
    expect(boxes(noteBlocks('✓ called the vet')[0]!)).toEqual([true]);
  });

  it('reads the markdown form the same way', () => {
    // So a list pasted from Notes and one typed here render identically.
    const blocks = noteBlocks('- [ ] wash blankets\n- [x] hand towels');
    expect(items(blocks[0]!)).toEqual(['1:wash blankets', '2:hand towels']);
    expect(boxes(blocks[0]!)).toEqual([false, true]);
  });

  it('does not show the brackets it understood', () => {
    // "• [ ] wash blankets" would be showing somebody their own syntax.
    expect(items(noteBlocks('- [ ] wash blankets')[0]!)).toEqual(['1:wash blankets']);
  });

  it('copes with the missing space Emily’s note actually has', () => {
    // Her note contains "- [ ]fill out forms at pots.net" — no space after the
    // bracket. Worth a test precisely because it came from a real paste.
    expect(items(noteBlocks('- [ ]fill out forms')[0]!)).toEqual(['1:fill out forms']);
  });

  it('leaves an ambiguous cross as a plain bullet', () => {
    // "✗" means done in some apps and skipped in others. A box drawn the wrong
    // way round is worse than a dot.
    expect(boxes(noteBlocks('✗ maybe')[0]!)).toEqual([null]);
  });

  it('takes a dash that autocorrect turned into an em dash', () => {
    expect(items(noteBlocks('— milk\n– eggs')[0]!)).toEqual(['1:milk', '2:eggs']);
  });

  it('keeps a plain bullet unchecked rather than unticked', () => {
    // `null`, not `false`: a dash is not an empty box, and drawing one would
    // put checkboxes on every list in the app.
    expect(boxes(noteBlocks('- milk')[0]!)).toEqual([null]);
  });
});

describe('an outline pasted from OneNote', () => {
  /*
   * Emily's note, as it really arrived: tab-indented, `•` at level one, `○` at
   * level two, `§` below that. Flattening it would throw away the only thing
   * that says which bill belongs to which heading.
   */
  const depths = (block: NoteBlock) =>
    block.kind === 'paragraph' ? [] : block.items.map((i) => i.depth);

  it('keeps the levels', () => {
    const blocks = noteBlocks('\t• Update Chorus\n\t\t○ Bills:\n\t\t\t§ Utility bill');
    expect(blocks.map((b) => b.kind)).toEqual(['bullets']);
    expect(items(blocks[0]!)).toEqual(['1:Update Chorus', '2:Bills:', '3:Utility bill']);
    expect(depths(blocks[0]!)).toEqual([1, 2, 3]);
  });

  it('counts two spaces as a level, which is the other convention', () => {
    expect(depths(noteBlocks('- a\n  - b\n    - c')[0]!)).toEqual([0, 1, 2]);
  });

  it('stops indenting before the text runs out of room', () => {
    // Nine levels deep would leave a column two words wide on a phone.
    expect(depths(noteBlocks('\t\t\t\t\t\t\t\t\t- deep')[0]!)).toEqual([4]);
  });
});

describe('Emily’s note, exactly as it is stored', () => {
  /*
   * The real thing, not a sketch of it: her note is the only one on the board
   * and the whole point of this change is that it reads better afterwards and
   * loses nothing. Anything invented would not have the missing space after
   * "[ ]", the URL jammed against a colon, or the OneNote glyphs.
   */
  const NOTE = [
    '- [ ] Sensory deprivation:https://share.google/isCqATEO9A4VX1QTk',
    '- [ ]fill out forms at pots.net for cardiology share',
    '- [ ] water plants ',
    '',
    '\t• Update Chorus',
    '\t\t○ Bills:',
    '\t\t\t§ Utility bill',
  ].join('\n');

  it('reads as a checklist and an outline, not one grey block', () => {
    const blocks = noteBlocks(NOTE);
    expect(blocks.map((b) => b.kind)).toEqual(['bullets', 'bullets']);

    const first = blocks[0]!;
    expect(first.kind === 'bullets' && first.items.map((i) => i.checked)).toEqual([
      false,
      false,
      false,
    ]);

    const second = blocks[1]!;
    expect(second.kind === 'bullets' && second.items.map((i) => i.depth)).toEqual([1, 2, 3]);
  });

  it('finds the link she jammed against a colon', () => {
    const first = noteBlocks(NOTE)[0]!;
    const spans = first.kind === 'bullets' ? first.items[0]!.spans : [];
    const link = spans.find((s) => s.kind === 'link');
    expect(link?.kind === 'link' && link.href).toBe('https://share.google/isCqATEO9A4VX1QTk');
  });

  it('loses not one word of it', () => {
    const rendered = noteBlocks(NOTE)
      .flatMap((b) =>
        b.kind === 'paragraph'
          ? b.spans.map((s) => s.value)
          : b.items.flatMap((i) => i.spans.map((s) => s.value)),
      )
      .join(' ');

    for (const phrase of [
      'Sensory deprivation',
      'fill out forms at pots.net for cardiology share',
      'water plants',
      'Update Chorus',
      'Bills:',
      'Utility bill',
    ]) {
      expect(rendered).toContain(phrase);
    }
  });
});

describe('a list button on somebody else’s pasted note', () => {
  /*
   * The bug a review caught, and the one Jake warned about: *"there is actually
   * a note now that emily added so we don't want to mess it up."*
   *
   * The buttons rebuilt the line from the *rendered* content, which has already
   * lost the `[ ]` and the leading tabs — so one tap turned "- [ ] water
   * plants" into "water plants" and flattened her outline a level, as a
   * permanent write with no undo. These use her real lines.
   */
  const tap = (line: string, kind: 'bullets' | 'numbers') => toggleListPrefix(line, 3, kind).text;

  it('keeps the checkbox when swapping the marker', () => {
    expect(tap('- [ ] water plants', 'numbers')).toBe('1. [ ] water plants');
  });

  it('keeps the checkbox when taking the marker off', () => {
    expect(tap('- [ ] water plants', 'bullets')).toBe('[ ] water plants');
  });

  it('keeps the indentation of a pasted outline', () => {
    expect(tap('\t\t○ Bills:', 'numbers')).toBe('\t\t1. Bills:');
    expect(tap('\t• Update Chorus', 'bullets')).toBe('\t• Update Chorus'.replace('• ', ''));
  });

  it('keeps two-space indentation too', () => {
    expect(tap('  - b', 'numbers')).toBe('  1. b');
  });

  it('round-trips without losing a level', () => {
    // Off then on must give back what it started with, indent included.
    const original = '\t\t- Bills:';
    const off = toggleListPrefix(original, 5, 'bullets').text;
    expect(toggleListPrefix(off, 5, 'bullets').text).toBe(original);
  });

  it('keeps the exact spacing she typed, including the missing one', () => {
    // Her note has "- [ ]fill out forms" with no space after the bracket.
    // A rewrite must not tidy that up — it is her text, not ours.
    expect(tap('- [ ]fill out forms', 'numbers')).toBe('1. [ ]fill out forms');
  });
});

describe('a section sign', () => {
  it('is prose when it starts a line on its own', () => {
    // "§ 12 of the lease says no pets" is a sentence, not a bullet.
    expect(noteBlocks('§ 12 of the lease says no pets').map((b) => b.kind)).toEqual(['paragraph']);
  });

  it('is still a bullet when indented, which is where OneNote puts it', () => {
    const blocks = noteBlocks('\t\t\t§ Utility bill');
    expect(blocks.map((b) => b.kind)).toEqual(['bullets']);
    expect(items(blocks[0]!)).toEqual(['1:Utility bill']);
  });
});

describe('a checkbox on a numbered line', () => {
  it('is read, not printed', () => {
    const blocks = noteBlocks('1. [ ] thing');
    expect(items(blocks[0]!)).toEqual(['1:thing']);
    const first = blocks[0]!;
    expect(first.kind === 'numbers' && first.items[0]!.checked).toBe(false);
  });
});
