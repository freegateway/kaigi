# Local UI translations for Kaigi

Kaigi uses administrator-controlled language files in
`public/lang/<lang>.json`. It does not load an external translation service.
Missing translated strings remain in English.

Set `UI_LANGUAGE` in `kaigi.conf` to choose the initial language. In the
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

3. Set `UI_LANGUAGE=hu` in `kaigi.conf` to make Hungarian the initial
   language, or select Hungarian from the local Language picker.

## Add or update a language

1. Copy [en.json](./en.json) to `<language-code>.json` (for example, `hu.json`) if the file does not exist.
2. Translate the **values** only. Keep English keys, punctuation, casing, and placeholders such as `{name}` unchanged.
3. For a new language, add its code, flag, and native name to `LANG_DISPLAY` in [I18n.js](../js/I18n.js).
4. Kaigi uses local translations. Select the language and open a meeting to verify it.

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

## Translation review

Kaigi does not include the upstream Google-based translation automation commands.
Review translations locally before shipping. Do not send private site text,
meeting names or deployment configuration to external translation services.

Dynamic video and participant dropdown captions (including conditional presenter actions)
are extracted into `buttons`. Translate newly added English values in each locale before shipping;
matching values can also be intentional for brands, technical identifiers, or shared vocabulary.
