# tools/

One-off conversions, kept because the next one will want the same care.

## The Macedonian transliteration

`translit.js` · `dicts.js` · `apply.js` — run once, on 25 September 2026, to turn 1607 Macedonian strings
from Latin into Cyrillic. Kept rather than deleted because what it records is not the table: it is the
list of things a table gets wrong, every one of which was found by looking rather than by reasoning.

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

**The check that found most of this was the second one.** Scanning the output for surviving Latin finds a
word that should have converted and did not. It cannot find the opposite — a word that should have stayed
Latin and was converted — because that word is now Cyrillic and looks like every other converted word.
`“Save as PDF”`, `cross-origin` and `Lagmansgatan` all passed the first check while being turned into
nonsense. The second check asks a different question: which words appear verbatim in the English for the
same key, and which of those stopped appearing.
