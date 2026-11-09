/**
 * The "What to test" steps (docs/TEST-NOW.md, built into the app; owner's request 2026-11-09) and
 * a short fingerprint of them: new steps get fresh tick boxes and the "new" dot on the 🧪 tab.
 */
import testNow from '../../docs/TEST-NOW.md?raw';

export function textKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The steps with the app's version filled in. */
export function testText(version: string): string {
  return testNow.replace(/\{version\}/g, version);
}
