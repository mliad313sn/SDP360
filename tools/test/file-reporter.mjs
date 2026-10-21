// Custom node:test reporter: one JSON line per finished test, carrying the
// file it came from. Consumed by tools/test/run-all.js to prove that every
// test file actually reported (G8.6).
export default async function* fileReporter(source) {
  for await (const ev of source) {
    if (ev.type === 'test:pass' || ev.type === 'test:fail') {
      const d = ev.data || {};
      yield JSON.stringify({ ok: ev.type === 'test:pass', file: d.file || null,
        name: d.name, nesting: d.nesting, kind: (d.details && d.details.type) || 'test' }) + '\n';
    }
  }
}
