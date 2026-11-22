// A faster drop-in replacement for csv-reader 1.0.0 (make.fun's reference CSV reader).
//
// run(input) returns, for every input {text, header}, exactly the answer csv-reader 1.0.0
// returns: {columns, rows, errors} under the same written broken-row policy —
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside
//     it one quote, and each CRLF or lone CR inside it is read as LF; what follows its
//     closing quote, up to the next comma or line break, is appended to it as it stands
//     (quote_junk, when the field ends); a quote that never closes is read as a literal
//     character and the text after it is read again as an unquoted field
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never
//     trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records
//     after it (every record when header is false), each padded with "" (short_row, with
//     fields: its count) or cut (long_row, with extra: the cut fields) to the first
//     record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every
//     LF, CRLF and lone CR inside a quoted field counted), row its record's index in rows
//     (null for the header), in the order met.
//
// Where the reference walks one character at a time and builds each field a character at
// a time, this reader scans with indexOf and moves whole runs of plain text with slice,
// so plain fields cost one scan and one slice instead of one step per character. Pure:
// no clock, no randomness, no locale, nothing kept from one call to the next.

// How a field ended: at the end of the text, at a comma (the record goes on), or at a
// line break (the record ends).
const END = 0;
const COMMA = 1;
const LINE_BREAK = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null:
  // the header). Every error met while reading the record carries these two.
  let recordLine = 1;
  let recordRow = null;

  // The field read last: its value, how it ended, and how many characters an unquoted
  // read kept (the quote_junk test). One shared record, refilled by every read.
  const fr = { value: '', ended: END, added: 0 };

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not
  // followed by LF is dropped (stray_cr). Plain runs are located with indexOf and moved
  // with slice; only a stray CR breaks a run. Fills fr.
  function readUnquoted(value) {
    let added = 0;
    let ended = END;
    for (;;) {
      const iC = text.indexOf(',', pos);
      const iN = text.indexOf('\n', pos);
      const iR = text.indexOf('\r', pos);
      let i = n;
      let kind = END;
      if (iC !== -1 && iC < i) { i = iC; kind = COMMA; }
      if (iN !== -1 && iN < i) { i = iN; kind = LINE_BREAK; }
      if (iR !== -1 && iR < i) { i = iR; kind = 3; }
      if (i > pos) {
        value += text.slice(pos, i);
        added += i - pos;
        pos = i;
      }
      if (kind === END) { ended = END; break; }
      if (kind === COMMA) { pos = i + 1; ended = COMMA; break; }
      if (kind === LINE_BREAK) { pos = i + 1; line += 1; ended = LINE_BREAK; break; }
      // A CR: with an LF after it, the field ends; without one it is dropped.
      if (text[i + 1] === '\n') {
        pos = i + 2;
        line += 1;
        ended = LINE_BREAK;
        break;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = i + 1;
    }
    fr.value = value;
    fr.ended = ended;
    fr.added = added;
  }

  // Appends the quoted run text[s, e) onto value: every CRLF or lone CR in it becomes one
  // LF, and every line break in it advances `line`. Runs without a CR are one slice plus
  // a count of their LFs.
  function appendQuotedRun(value, s, e) {
    let r = text.indexOf('\r', s);
    if (r === -1 || r >= e) {
      let k = text.indexOf('\n', s);
      while (k !== -1 && k < e) {
        line += 1;
        k = text.indexOf('\n', k + 1);
      }
      return value + text.slice(s, e);
    }
    let out = value;
    let i = s;
    for (;;) {
      let cr = text.indexOf('\r', i);
      const stop = cr === -1 || cr >= e ? e : cr;
      let k = text.indexOf('\n', i);
      while (k !== -1 && k < stop) {
        line += 1;
        k = text.indexOf('\n', k + 1);
      }
      out += text.slice(i, stop);
      if (stop === e) break;
      out += '\n';
      line += 1;
      i = stop + 1;
      if (text[i] === '\n') i += 1; // the LF of a CRLF pair
    }
    return out;
  }

  // Reads a quoted field whose opening quote is at pos. Fills fr.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is
        // read again as unquoted. Line and value from the failed scan are thrown away.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      if (q > pos) value = appendQuotedRun(value, pos, q);
      if (text[q + 1] === '"') {
        value += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1;
      break;
    }
    // The field closed. What follows decides how it ended.
    if (pos >= n) {
      fr.value = value;
      fr.ended = END;
      fr.added = 0;
      return;
    }
    const c = text[pos];
    if (c === ',') {
      pos += 1;
      fr.value = value;
      fr.ended = COMMA;
      fr.added = 0;
      return;
    }
    if (c === '\n') {
      pos += 1;
      line += 1;
      fr.value = value;
      fr.ended = LINE_BREAK;
      fr.added = 0;
      return;
    }
    if (c === '\r' && text[pos + 1] === '\n') {
      pos += 2;
      line += 1;
      fr.value = value;
      fr.ended = LINE_BREAK;
      fr.added = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or
    // line break; if anything was appended, the field carries quote_junk.
    readUnquoted(value);
    if (fr.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const cc = text.charCodeAt(pos);
      if (cc === 10) {
        pos += 1;
        line += 1;
      } else if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
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
    let quoted = false;
    for (;;) {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        readQuoted();
        fields.push(fr.value);
        if (fr.ended !== COMMA) break;
      } else {
        quoted = false;
        // The hot path, inlined: one charCodeAt pass over the field, a slice per run
        // between stray CRs (a field with none is a single slice). Three indexOf calls
        // per field cost more than the pass itself on short fields, and the CR search
        // rescans far ahead in LF files.
        let value = '';
        let segStart = pos;
        let i = pos;
        let ended = END;
        for (;;) {
          if (i >= n) {
            pos = n;
            ended = END;
            break;
          }
          const cc = text.charCodeAt(i);
          if (cc === 44) {
            pos = i + 1;
            ended = COMMA;
            break;
          }
          if (cc === 10) {
            pos = i + 1;
            line += 1;
            ended = LINE_BREAK;
            break;
          }
          if (cc === 13) {
            if (text.charCodeAt(i + 1) === 10) {
              pos = i + 2;
              line += 1;
              ended = LINE_BREAK;
              break;
            }
            if (i > segStart) value += text.slice(segStart, i);
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            i += 1;
            segStart = i;
            continue;
          }
          i += 1;
        }
        if (i > segStart) value += text.slice(segStart, i);
        fields.push(value);
        if (ended !== COMMA) break;
      }
    }

    // A line that held only stray CRs is left with no characters: no record (its
    // stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

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
