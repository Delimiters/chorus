import { hasMarkup, noteBlocks, notePreview, toggleListPrefix, type NoteBlock } from './notes';

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

  it('loses no words', () => {
    /*
     * The guarantee that matters for somebody's note: every character of input
     * is still somewhere in the output. A parser that silently eats a line is
     * worse than no parser.
     */
    const note = ['Buy:', '- milk', '* eggs', '2) bread', 'done by 5', 'see www.example.com'].join(
      '\n',
    );
    const rendered = noteBlocks(note)
      .flatMap((b) =>
        b.kind === 'paragraph'
          ? b.spans.map((s) => s.value)
          : b.items.flatMap((i) => i.spans.map((s) => s.value)),
      )
      .join('');

    for (const word of ['Buy:', 'milk', 'eggs', 'bread', 'done by 5', 'www.example.com']) {
      expect(rendered).toContain(word);
    }
  });
});

describe('spotting markup without parsing', () => {
  it('knows the difference', () => {
    expect(hasMarkup('- milk')).toBe(true);
    expect(hasMarkup('1. milk')).toBe(true);
    expect(hasMarkup('just a note')).toBe(false);
    expect(hasMarkup('3-4 bags')).toBe(false);
    expect(hasMarkup('')).toBe(false);
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
