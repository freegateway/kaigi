# Local UI translations for the HARDENED build

The HARDENED build uses administrator-controlled language files in
`public/lang/<lang>.json`. It does not load an external translation service.
Missing translated strings remain in English.

Set `UI_LANGUAGE` in `mirotalk.conf` to choose the initial language. In the
meeting settings, the local Language picker switches between English and the
packaged languages without reloading the page. A browser choice is remembered
as `uiLanguageOverride` and can be reset by choosing the server default.

## How to add a language

Use `public/lang/en.json` as the starting point for every translation. It contains the
current in-room UI strings, grouped by namespace, with each English source string used as
both the key and the initial value.

1. Copy `en.json` to a new file named after the language code used in `UI_LANGUAGE`, e.g.
   Hungarian:

    ```bash
    cp public/lang/en.json public/lang/hu.json
    ```

2. Open `hu.json` and translate each **value**. Leave every **key** (the English source
   string) unchanged.

    ```json
    {
        "tooltips": {
            "Mute": "Némítás"
        },
        "dialogs": {
            "Cancel": "Mégse"
        }
    }
    ```

3. Set `UI_LANGUAGE=hu` in `mirotalk.conf` to make Hungarian the initial
   language, or select Hungarian from the local Language picker.

## Add or update a language

1. Copy [en.json](./en.json) to `<language-code>.json` (for example, `hu.json`) if the file does not exist.
2. Translate the **values** only. Keep English keys, punctuation, casing, and placeholders such as `{name}` unchanged.
3. For a new language, add its code, flag, and native name to `LANG_DISPLAY` in [I18n.js](../js/I18n.js).
4. Set `UI_TRANSLATION_MODE=native` or `auto`, select the language, and open a room to verify it.

Missing or empty values fall back to English, so partial translations are supported.

| Namespace  | UI content                                         |
| ---------- | -------------------------------------------------- |
| `tooltips` | Hover hints                                        |
| `buttons`  | Button text, attributes, and dynamic menu captions |
| `labels`   | Static text, headings, and label attributes        |
| `dialogs`  | Popup titles, text, buttons, and inputs            |
| `toasts`   | Notifications                                      |

To exclude an HTML element from translation, use `class="notranslate"`, `translate="no"`,
or `data-i18n-skip`.

Toast notifications are translated when displayed.
Use literal messages in `userLog()` calls so the extractor can discover toast keys;
for conditional messages, put each literal in its own branch.
Keep lifecycle callbacks in the options passed to `Swal.fire()`
so the translation wrapper preserves them.

## Synchronize translation keys

Run from the repository root after changing UI strings:

```bash
npm run lang
```

This regenerates `en.json` and synchronizes the other language files, preserving existing
translations, keeping keys in the same order as `en.json`, adding missing keys with English values,
and removing stale keys. Review the diff.

## Auto-translate missing values (optional)

Use machine translation to fill only missing/untranslated locale values
(`""` or values still equal to the English key), while skipping `en.json`.

Install dependency (recommended on macOS/Homebrew Python and other PEP 668 environments):

```bash
npm run lang:translate:setup
```

This creates a local `.venv` and installs `deep-translator` there.

If you prefer manual setup:

```bash
python3 -m venv .venv
.venv/bin/python3 -m pip install --upgrade pip
.venv/bin/python3 -m pip install deep-translator
```

Run translation:

```bash
npm run lang:translate
```

The translator now sends requests in small batches with automatic retry/backoff and
deliberate request pacing (`sleep`) to reduce
Google rate-limit failures. If a run still stops due temporary limits, wait a bit
and run `npm run lang:translate` again.
Progress is saved after each batch, so reruns resume from the already translated values.

Optional targeted run (single locale):

```bash
npm run lang:translate -- --locale it
```

Or run both extraction/sync + translation:

```bash
npm run lang:auto
```

This is a bootstrap helper. Review machine-translated strings before shipping.

Dynamic video and participant dropdown captions (including conditional presenter actions)
are extracted into `buttons`. Translate newly added English values in each locale before shipping;
matching values can also be intentional for brands, technical identifiers, or shared vocabulary.
