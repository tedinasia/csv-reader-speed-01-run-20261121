// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's
// {columns, rows, errors} for the input {text, header}, but reads the text with
// native indexOf/slice jumps instead of one character at a time.
//
// The reading policy (identical to csv-reader 1.0.0):
// - a U+FEFF at the very start is dropped;
// - a record ends at LF or CRLF, and a line left with no characters is no record;
// - outside quotes a CR not followed by LF is dropped (error stray_cr);
// - a field that opens with a quote runs to the next quote that is not doubled,
//   "" inside it is one quote, and each CRLF or lone CR inside it is read as LF;
//   what follows its closing quote, up to the next comma or line break, is
//   appended as it stands (quote_junk, when the field ends); a quote that never
//   closes is a literal character, and the text after it is read again as
//   unquoted (unterminated_quote);
// - a quote inside an unquoted field is a literal character; fields stay
//   strings, never trimmed or converted;
// - columns is the first record when header is true, else null; rows holds the
//   records after it, each padded with "" (short_row) or cut (long_row) to the
//   first record's width;
// - each error is {code, line, row}, in the order met: line the 1-based line
//   its record starts on, row its record's index in rows (null for the header).

// How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0; // drop a leading U+FEFF
  let line = 1; // the line the next character is on

  // The record being read: the line it starts on and the index in rows it
  // takes (null for the header). Errors read these, never the moving line.
  let recordLine = 1;
  let recordRow = null;

  // The last field read: how it ended, and how many characters the unquoted
  // reader kept (for quote_junk). The readers set these and return the value,
  // so no object is built per field.
  let fEnded = END;
  let fAdded = 0;

  // The next LF at or after pos, cached while pos stays at or before it:
  // -2 not cached yet, -1 none left. An unquoted field ends at the next
  // comma or at this LF, whichever comes first, so most fields on one line
  // share one indexOf.
  let nlCache = -2;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break. A CR not followed by LF is dropped (stray_cr) and the field goes
  // on. Sets fEnded and fAdded (characters kept) and returns the field. The
  // field's span is taken with one slice per delimiter jump; only a span
  // holding a CR falls back to splitting on it.
  function readUnquoted(value) {
    fAdded = 0;
    for (;;) {
      if (nlCache === -2 || (nlCache >= 0 && pos > nlCache)) nlCache = text.indexOf('\n', pos);
      const nIdx = nlCache;
      const cIdx = text.indexOf(',', pos);
      if (cIdx !== -1 && (nIdx === -1 || cIdx < nIdx)) {
        const seg = text.slice(pos, cIdx);
        if (seg.indexOf('\r') === -1) {
          if (seg.length !== 0) {
            value += seg;
            fAdded += seg.length;
          }
          pos = cIdx + 1;
          fEnded = COMMA;
          return value;
        }
        const parts = seg.split('\r');
        for (let i = 1; i < parts.length; i++) {
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        }
        const kept = parts.join('');
        if (kept.length !== 0) {
          value += kept;
          fAdded += kept.length;
        }
        pos = cIdx + 1;
        fEnded = COMMA;
        return value;
      }
      if (nIdx !== -1) {
        const crlf = nIdx > pos && text.charCodeAt(nIdx - 1) === 13;
        const end = crlf ? nIdx - 1 : nIdx;
        const seg = text.slice(pos, end);
        if (seg.indexOf('\r') === -1) {
          if (seg.length !== 0) {
            value += seg;
            fAdded += seg.length;
          }
          pos = nIdx + 1;
          line += 1;
          fEnded = LINE_BREAK;
          return value;
        }
        const parts = seg.split('\r');
        for (let i = 1; i < parts.length; i++) {
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        }
        const kept = parts.join('');
        if (kept.length !== 0) {
          value += kept;
          fAdded += kept.length;
        }
        pos = nIdx + 1;
        line += 1;
        fEnded = LINE_BREAK;
        return value;
      }
      const seg = text.slice(pos);
      if (seg.indexOf('\r') === -1) {
        if (seg.length !== 0) {
          value += seg;
          fAdded += seg.length;
        }
        pos = n;
        fEnded = END;
        return value;
      }
      const parts = seg.split('\r');
      for (let i = 1; i < parts.length; i++) {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      }
      const kept = parts.join('');
      if (kept.length !== 0) {
        value += kept;
        fAdded += kept.length;
      }
      pos = n;
      fEnded = END;
      return value;
    }
  }

  // Reads a quoted field whose opening quote is at pos. The closing quote is
  // found with indexOf jumps (a quote followed by another quote is doubled,
  // not a close); the content is one slice, with "" folded and CR/CRLF read
  // as LF only when the content holds them. Sets fEnded and returns the value.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let scan = pos + 1;
    let closeIdx = -1;
    for (;;) {
      const q = text.indexOf('"', scan);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        scan = q + 2;
        continue;
      }
      closeIdx = q;
      break;
    }
    if (closeIdx === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted. The line is still the opening
      // quote's line, since the failed scan counted no breaks.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    const raw = text.slice(open + 1, closeIdx);
    let value;
    const hasCR = raw.indexOf('\r') !== -1;
    const hasNL = raw.indexOf('\n') !== -1;
    const hasDQ = raw.indexOf('"') !== -1;
    if (hasCR || hasNL) {
      const breaks = raw.match(/\r\n|\r|\n/g);
      line += breaks === null ? 0 : breaks.length;
      value = raw.replace(/\r\n?/g, '\n');
      if (hasDQ) value = value.replaceAll('""', '"');
    } else if (hasDQ) {
      value = raw.replaceAll('""', '"');
    } else {
      value = raw;
    }
    pos = closeIdx + 1;
    if (pos >= n) {
      fEnded = END;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fEnded = COMMA;
      return value;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fEnded = LINE_BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (fAdded > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    do {
      lastQuoted = text.charCodeAt(pos) === 34;
      fields.push(lastQuoted ? readQuoted() : readUnquoted(''));
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
