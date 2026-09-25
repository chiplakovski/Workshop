# tools/

One-off conversions, kept because the next one will want the same care.

## The Macedonian transliteration

`translit.js` · `dicts.js` · `apply.js` — run twice on 25 September 2026: 1607 Macedonian strings from
Latin into Cyrillic, and then 140 more that the first run had skipped or never read. Kept rather than
deleted because what it records is not the table: it is the list of things a table gets wrong, every one of
which was found by looking rather than by reasoning — and because "run once" is what the first version of
this sentence said, before the second run had to happen.

    node tools/apply.js      # from the repository root

`tests/integrity.js` is what keeps the result true — it reads every page's `mk` dictionary and fails on a
Latin string, so a new one added in the old transliteration is caught rather than noticed later.

**What a naive letter table would have got wrong here**, in the order the mistakes were found:

| | |
|---|---|
| `dz` | д+з, not ѕ — `nadzornik` is надзорник. Mapping it to ѕ invents a letter. |
| `dj` vs `gj` | `Odjava` is Одјава (д+ј); `lugje` is луѓе (ѓ). One keystroke apart, opposite answers. |
| `ñ` | A second spelling of њ, used 35 times. A table built from `nj` alone leaves it as a Latin letter. |
| `è` | ѐ in the 32 `sè`/`Sè`, and a typo for `č` in exactly two words. Listed, not mapped. |
| No diacritics | hub-desktop's "your data" panel was typed without them: `sto`, `prelistuvac`, `ke`. A table gives сто, прелистувац, ке — wrong Cyrillic, which is worse than obvious Latin. |
| `locale: "mk"` | A BCP-47 tag, not prose. `мк` is not a language any browser knows, and every date on every Macedonian screen would have fallen back. |
| `Cena/lead`, `DDV/EMBS` | Protected as file paths by a pattern that only asked for a slash. A path here ends in a filename with an extension. |
| `{leads}` | A placeholder name, translated to `{лидови}` because the word passes ran before the protection. |
| `pipeline`, `lead` | English, not loanwords. Translated (тек, лид) rather than transliterated. |
| `vs` | Versus, four times. вс is two Cyrillic letters meaning nothing; Macedonian writes сп. |
| `Lagmansgatan` | A Swedish street in the firm's own address. An address has to be typeable by whoever reads it. |
| `“Save as PDF”` | The label on the browser's own print dialog, in English whatever the page is in. |

**Two heuristics were written, and both were already wrong** before they ran. "All caps means a code" would
have protected `PRISTAP`, `VKUPNO` and `DDV` — Macedonian words in capitals. "Looks like a language tag"
would have protected `od` and `da`, which are Macedonian for "by" and "yes". Both were replaced by a list
somebody read.

## The second run, and why there had to be one

The first run reported 1607 values converted and every check green. 138 strings across three screens were
still half Latin — `Meѓuzbir`, `Režiski troшoci`, `Kvalifikuvani prilики` — and three more pages had never
been read at all. Two faults, and they were the same fault twice:

| | |
|---|---|
| `apply.js` skipped any value containing a Cyrillic character | Meant as "already converted, leave it". Actually meant "partly converted, leave it half-Latin". The translator had converted only the letters with no ASCII form — š→ш, ḱ→ќ, њ, ѓ — so every one of these values held Cyrillic on the first pass and was skipped. |
| `tests/integrity.js` passed any value containing a Cyrillic character | The same wrong question, asked by the check that was supposed to catch the tool. One ѓ in a Latin sentence satisfied both. |

Both now ask `latinLeftIn(value)` — one detector, exported from `translit.js`, used by the tool and by the
check — which hides the placeholders, paths, codes and keep-list words and then asks whether a Latin *word*
is left. A string may hold `WPQR`, `USB`, `SEK` or `backend/backup.sh`. It may not hold `uzbir`.

`dicts.js` could not read three pages. Quality, Reports and Equipment write `const i18n = { en:{…} }`
rather than `T.en = {…}`, so `dictsIn` returned null, `apply.js` skipped them without printing a line, and
a page the tool cannot read looked exactly like a page with nothing to do. It reads both shapes now, and
`apply.js` reports a page whose Macedonian it cannot read rather than passing over it.

**What the second run found by looking**, again in the order found:

| | |
|---|---|
| `\b` and Cyrillic | In JavaScript a Cyrillic letter is not a word character, so `/\bgroupи\b/` asks for a boundary after `и` and never matches. Two new entries silently did nothing, which looks exactly like a table that is right. |
| Nested protection | `“{stage}”` has the placeholder stashed, then the quoted run stashed around the marker. One restore pass put the outer run back and shipped the inner marker: `“\u00000\u0000”`. Restored in a loop now. |
| `„…“` | The Macedonian quote pair. Only the English `“…”` was protected, so `„Save as PDF“` became `„Саве ас PDF“` — an instruction to press a button that does not exist. |
| `WPQR` | Not in the keep list, because the welding tables did not exist when the list was built. Came back as `WПQР`. |
| `USB`, `Bluetooth` | `УСБ` and `Блуетоотх`, on the barcode panels. Neither is written that way on any cable. |
| `groupи`, `leadot` | An English stem wearing a Macedonian ending — the same fault as `leadovi`, one run later. |
| `veke` | ќе again, bare: `веке` is a different word from `веќе`. |
| `real AI` | Two English words in a Macedonian sentence. `реал АИ` is neither language. |
| `Aktiven kvalitativen zabranа` | Not a transliteration fault at all. забрана is feminine, so the phrase was wrong in either script — the conversion just made it legible enough to notice. |

**The check that found most of this was the second one.** Scanning the output for surviving Latin finds a
word that should have converted and did not. It cannot find the opposite — a word that should have stayed
Latin and was converted — because that word is now Cyrillic and looks like every other converted word.
`“Save as PDF”`, `cross-origin` and `Lagmansgatan` all passed the first check while being turned into
nonsense. The second check asks a different question: which words appear verbatim in the English for the
same key, and which of those stopped appearing.
