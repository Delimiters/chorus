import { noteSegments } from './links';

/** The whole input always comes back, which is the property everything else rests on. */
const rejoin = (note: string) =>
  noteSegments(note)
    .map((s) => s.value)
    .join('');

const links = (note: string) =>
  noteSegments(note)
    .filter((s) => s.kind === 'link')
    .map((s) => s.value);

const hrefs = (note: string) =>
  noteSegments(note).flatMap((s) => (s.kind === 'link' ? [s.href] : []));

describe('what gets picked out', () => {
  it('finds a plain https address', () => {
    expect(links('order from https://example.com/part-1234 today')).toEqual([
      'https://example.com/part-1234',
    ]);
  });

  it('finds http as well as https', () => {
    expect(links('the router is at http://192.168.1.1')).toEqual(['http://192.168.1.1']);
  });

  it('finds a bare www address, which is how people actually type them', () => {
    expect(links('www.homedepot.com has the filters')).toEqual(['www.homedepot.com']);
  });

  it('finds more than one', () => {
    expect(links('compare https://a.com and https://b.com')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });
});

describe('what is deliberately left alone', () => {
  /*
   * The whole reason this is not "anything with a dot in it". Household notes
   * are full of measurements, aisle numbers and abbreviations, and turning
   * those blue would be worse than doing nothing at all.
   */
  it.each([
    ['a measurement', 'use the 3.5mm bit'],
    ['an aisle', 'aisle 4.B, back wall'],
    ['an abbreviation', 'call Dr. Miller about it'],
    ['a sentence', 'Rinse it. Then dry it.'],
    ['a bare domain with no scheme', 'buy it from homedepot.com'],
  ])('leaves %s as plain text', (_name, note) => {
    expect(links(note)).toEqual([]);
    expect(noteSegments(note)).toEqual([{ kind: 'text', value: note }]);
  });

  it('does not treat a lone "www." as an address', () => {
    expect(links('it said www. and then nothing')).toEqual([]);
  });
});

describe('where a link stops', () => {
  /*
   * The genuinely fiddly part, and the reason this is a pure function rather
   * than something discovered through a rendered component.
   */
  it('leaves a full stop to the sentence', () => {
    expect(links('see https://example.com.')).toEqual(['https://example.com']);
    expect(rejoin('see https://example.com.')).toBe('see https://example.com.');
  });

  it.each([',', ';', ':', '!', '?'])('leaves a trailing "%s" behind', (mark) => {
    expect(links(`https://example.com${mark} and then`)).toEqual(['https://example.com']);
  });

  it('keeps a bracket the address actually needs', () => {
    // Wikipedia really does end URLs this way, and trimming it blindly gives a
    // link that 404s.
    const note = 'https://en.wikipedia.org/wiki/Mercury_(planet)';
    expect(links(note)).toEqual([note]);
  });

  it('drops a bracket that was closing the sentence', () => {
    expect(links('(see https://example.com)')).toEqual(['https://example.com']);
  });

  it('keeps a trailing slash, which is part of the address', () => {
    expect(links('https://example.com/')).toEqual(['https://example.com/']);
  });
});

describe('the guarantee the rest depends on', () => {
  it.each([
    'order from https://example.com/part-1234 today',
    'see https://example.com.',
    '(see https://example.com)',
    'www.homedepot.com has the filters',
    'no links at all here',
    'https://a.com and https://b.com',
  ])('gives the whole note back for %p', (note) => {
    // Concatenating every segment must reproduce the input exactly, or a bad
    // pattern could silently swallow part of somebody's note.
    expect(rejoin(note)).toBe(note);
  });

  it('returns nothing at all for an empty note, so a caller can test length', () => {
    expect(noteSegments('')).toEqual([]);
  });

  it('returns one plain segment when there is nothing to link', () => {
    expect(noteSegments('just words')).toEqual([{ kind: 'text', value: 'just words' }]);
  });
});

describe('what gets opened', () => {
  it('passes a scheme through untouched', () => {
    expect(hrefs('https://example.com/x')).toEqual(['https://example.com/x']);
  });

  it('gives a bare www address a scheme, or nothing will open it', () => {
    // A URL opener handed "www.example.com" either refuses it or reads it as a
    // file path.
    expect(hrefs('www.example.com')).toEqual(['https://www.example.com']);
  });

  it('gives an upper-case WWW a scheme too', () => {
    expect(hrefs('WWW.EXAMPLE.COM')).toEqual(['https://WWW.EXAMPLE.COM']);
  });
});

describe('what trims down to nothing usable', () => {
  /*
   * A review found the original guard here was dead code twice over: it tested
   * `url === 'www.'`, which `trimTrailing` can never produce, and
   * `url.length === 0`, which a match beginning `h` or `w` cannot reach. The
   * test named for it passed because the regex requires a character after the
   * dot, not because the guard ran.
   *
   * These are the inputs that actually reach it, and each produced a blue
   * underlined link that opened nothing — `Linking.openURL('www')` rejects,
   * and `NoteText` swallows the rejection.
   */
  it.each([
    ['a doubled dot', 'it said www.. ok'],
    ['a scheme with nothing after it', 'see http://. for details'],
    ['a scheme ended by a comma', 'https://, then what'],
    ['a scheme ended by a full stop', 'try https://. ok'],
  ])('does not make a link of %s', (_name, note) => {
    expect(links(note)).toEqual([]);
  });

  it('still keeps the shortest thing that is a real address', () => {
    // The guard must not be so eager that it eats one-character hosts.
    expect(links('go to www.a')).toEqual(['www.a']);
    expect(hrefs('go to www.a')).toEqual(['https://www.a']);
  });

  it('gives the whole note back even when nothing is linked', () => {
    expect(rejoin('it said www.. ok')).toBe('it said www.. ok');
  });
});

describe('how long it takes', () => {
  it('does not go quadratic on a run of closing brackets', () => {
    /*
     * `trimTrailing` re-scanned the string twice per stripped character in its
     * first version. Measured on node: 92ms at 2,000 brackets, 5.2s at 20,000.
     * A note is capped at 2,000 characters, so it was bounded — but `NoteText`
     * calls this in a render body, on a phone.
     */
    /*
     * Twenty thousand, not the two thousand a note is capped at, and the
     * threshold is a second rather than a tight bound. A timing assertion is
     * only worth having if the margin is enormous: the linear version does
     * this in single-digit milliseconds and the quadratic one took 5.2s, so
     * there is no CI machine slow enough to blur the two. At 2,000 the gap was
     * 92ms against a 150ms bound, which is a flaky test waiting to happen.
     */
    const note = `https://example.com${')'.repeat(20_000)}`;
    const started = Date.now();
    noteSegments(note);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
