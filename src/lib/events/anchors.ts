// Sentence-anchor utilities for text events.
//
// Semantics:
// - A "sentence" is a maximal run of text that ends at one of `.!?`
//   (followed by optional whitespace) or at a body boundary.
// - Empty string anchors mean "the document boundary" (start or end).
// - To apply an anchor edit we look for the unique adjacent occurrence of
//   `beforeSentence + afterSentence` in the body. If found we splice
//   `text` between them. If the anchor pair cannot be located OR is
//   ambiguous, the application fails.

const SENTENCE_TERMINATOR = /[.!?]/;

export interface SentenceWindow {
  before: string;
  after: string;
}

function sentenceStartBefore(body: string, idx: number): number {
  // Find the start of the sentence whose end is at or before idx.
  let i = idx;
  while (i > 0) {
    if (SENTENCE_TERMINATOR.test(body.charAt(i - 1))) break;
    i--;
  }
  return i;
}

function sentenceEndAfter(body: string, idx: number): number {
  let i = idx;
  while (i < body.length) {
    const ch = body.charAt(i);
    i++;
    if (SENTENCE_TERMINATOR.test(ch)) break;
  }
  return i;
}

/**
 * Truncate an anchor pair to at most `maxChars` characters per side,
 * keeping the characters closest to the edit point. Pass 0 for "no limit".
 */
export function truncateAnchors(
  before: string,
  after: string,
  maxChars: number,
): { before: string; after: string } {
  if (maxChars <= 0) return { before, after };
  const truncBefore = before.length > maxChars ? before.slice(before.length - maxChars) : before;
  const truncAfter = after.length > maxChars ? after.slice(0, maxChars) : after;
  return { before: truncBefore, after: truncAfter };
}

/**
 * Capture the sentence immediately before and after an edit position.
 *
 * The "before" anchor is the run of text from the last sentence end up to
 * `position`. If `position` itself sits right after a terminator (so the
 * preceding sentence already closed), we widen `before` to include that
 * preceding sentence so we get a non-empty anchor whenever possible.
 *
 * Mirror logic for `after`. Anchors only stay empty when the document is
 * empty on that side.
 */
export function sentenceWindowAt(body: string, position: number): SentenceWindow {
  const pos = Math.max(0, Math.min(body.length, position));

  // The anchor pair MUST be exactly `body[beforeStart..pos] + body[pos..afterEnd]`
  // so that `before + after` is the literal substring spanning the edit point.
  // We pick `beforeStart` and `afterEnd` to be the surrounding sentence
  // boundaries — but never strip the characters touching `pos` itself,
  // otherwise the join would no longer equal the body and the anchor
  // couldn't be located after replay.

  let beforeStart: number;
  if (pos === 0) {
    beforeStart = 0;
  } else if (SENTENCE_TERMINATOR.test(body.charAt(pos - 1))) {
    // We're at the very end of a sentence; widen back to include it so the
    // anchor isn't just a single terminator.
    beforeStart = sentenceStartBefore(body, pos - 1);
  } else {
    beforeStart = sentenceStartBefore(body, pos);
  }
  const before = body.slice(beforeStart, pos);

  const afterEnd = sentenceEndAfter(body, pos);
  const after = body.slice(pos, afterEnd);

  return { before, after };
}

/**
 * Locate the unique split point between `before` and `after` in `body`.
 * Returns the character index where the split sits, or null if missing/ambiguous.
 *
 * Empty `before` matches the start of the body; empty `after` matches the end.
 */
export function locateAnchor(
  body: string,
  before: string,
  after: string,
): number | null {
  if (before === '' && after === '') {
    return body.length === 0 ? 0 : null;
  }
  if (before === '') {
    if (!body.startsWith(after)) return null;
    if (after.length > 0 && body.indexOf(after, 1) !== -1) {
      // ambiguous: appears more than once
      return null;
    }
    return 0;
  }
  if (after === '') {
    if (!body.endsWith(before)) return null;
    const splitIdx = body.length - before.length;
    // Look for an earlier occurrence of `before`. We need `fromIndex < splitIdx`
    // so the searched range doesn't include the trailing match itself.
    if (splitIdx > 0 && body.lastIndexOf(before, splitIdx - 1) !== -1) return null;
    return body.length;
  }
  const joined = before + after;
  const first = body.indexOf(joined);
  if (first === -1) return null;
  const second = body.indexOf(joined, first + 1);
  if (second !== -1) return null;
  return first + before.length;
}

/** Returns body with `text` inserted at the anchor, or null if anchor missing. */
export function applyInsert(
  body: string,
  before: string,
  after: string,
  text: string,
): string | null {
  const at = locateAnchor(body, before, after);
  if (at === null) return null;
  return body.slice(0, at) + text + body.slice(at);
}

/**
 * Returns body with the anchored `text` removed, or null if anchor missing
 * or the text at the anchor doesn't match.
 */
export function applyDelete(
  body: string,
  before: string,
  after: string,
  text: string,
): string | null {
  if (text.length === 0) return body;
  // Match `before + text + after` uniquely; remove `text`.
  const joined = before + text + after;
  const first = body.indexOf(joined);
  if (first === -1) return null;
  const second = body.indexOf(joined, first + 1);
  if (second !== -1) return null;
  const cut = first + before.length;
  return body.slice(0, cut) + body.slice(cut + text.length);
}
