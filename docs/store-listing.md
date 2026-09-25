# Chrome Web Store listing

Everything needed to publish QuickOCR: the listing copy, the keywords, the
permission justifications and the assets in `store/`.

## How the store actually ranks items

Chrome's own guidance ([Create a compelling listing](https://developer.chrome.com/docs/webstore/best-listing))
is explicit about this: ranking is a heuristic built from **user ratings** and
**usage statistics (installs vs uninstalls over time)**, plus quality signals
such as a clear purpose, an intuitive setup and ease of use. The two text fields
that exist are the **title** (45 characters in the dashboard) and the **summary**
(132 characters, the line shown on the home page, category pages and in search
results).

Two consequences, both by policy:

* Keyword-stuffing the title is called out as something *not* to do, and the
  Spam and Abuse policy treats misleading metadata as a violation. The title
  below is descriptive, not padded.
* Because ranking follows installs and ratings, the honest way to be found is a
  clear listing plus a good first-run experience. The keyword sets below are for
  the description and the dashboard's own fields, where they read naturally.

## Listing copy (paste into the developer dashboard)

**Name** (45 characters max)

```
QuickOCR - Select Area & Extract Text Offline
```

Alternative if you prefer the benefit first:

```
QuickOCR - Select Area, Copy Text, Fully Offline
```

**Summary** (132 characters max - this is the line that shows up in search)

```
Select any area on screen and copy the text instantly. Fully offline OCR - no uploads, no accounts, no tracking.
```

Alternative, keyword-forward but still honest:

```
Screen text scanner: drag a box over any text, image or PDF and copy it instantly. Offline OCR, nothing uploaded.
```

**Category:** Productivity

**Language:** English

## Long description

```
QuickOCR turns any part of your screen into editable text.

Click the toolbar icon (or press Alt+Shift+O), drag a box over what you want to
read, and press Read text. The recognised text appears in a card and is copied
to your clipboard straight away, so you can paste it wherever you need it.

WHAT IT IS GOOD AT

* Screenshots, screenshares and video frames where the text cannot be selected
* Image-only PDFs, scanned pages, receipts and photographed documents
* Error messages, logs and terminal output you need to search or report
* Reading text out of images, charts, tables and slides
* Copying a phone number, address or code that is shown as an image

PRIVACY: NOTHING IS UPLOADED

Recognition runs entirely on your device with the Tesseract OCR engine compiled
to WebAssembly. No image, no recognised text and no page content ever leaves
your browser. There are no accounts, no analytics, no ads and no tracking, and
the code contains no remote scripts.

English recognition works offline out of the box. Other languages are a
one-click download (2-15 MB) from the pinned tessdata source; after that they
work offline too. The language download is the only network request the
extension can make, and it never contains any of your data.

ACCURACY CONTROLS

* Document profile: Auto, Document, Screenshot, Handwriting or Code
* Layout preset: Balanced paragraphs, Verbatim columns (good for tables and
  terminals) or Compact
* Automatic image enhancement: upscaling for small text, contrast stretch,
  sharpening, adaptive black-and-white and light-on-dark inversion
* Confidence score for every result, with a clearly flagged review state

MADE FOR EVERYDAY USE

* The result card is editable: fix a character and copy again
* Copy the text, download a .txt, or copy the recognised image itself
* Keyboard friendly: Enter reads the selection, arrow keys nudge it, Esc always
  steps back
* Right-click entry in the context menu and an Alt+Shift+O shortcut
* No page content is collected, and the extension declares only the permissions
  it needs to take the screenshot and read the pixels it captured

Works in Chrome and Chromium-based browsers that support Manifest V3 extensions
(Chrome 116 and newer).
```

## Keyword sets

Put the primary terms in the summary and the first lines of the description -
that is the text users and search see. The rest belong in the description body
where they read naturally; adding them as a comma-separated list at the end of
the description is what the Spam and Abuse policy calls out.

Primary:

`OCR`, `screen OCR`, `text from image`, `copy text from screen`, `screenshot to text`, `image to text`, `offline OCR`

Secondary:

`select area text`, `extract text`, `screen text scanner`, `picture to text`, `photo to text`, `scan text`, `read text from image`, `capture text`

Use-case keywords:

`PDF text`, `scanned document`, `receipt OCR`, `handwriting OCR`, `error message`, `log capture`, `video frame text`, `screenshot reader`, `document scanner`, `text scanner`

Trust keywords:

`privacy first`, `no upload`, `no account`, `no tracking`, `works offline`, `local processing`, `on-device OCR`, `open source`

The same terms are mirrored in `package.json` (`keywords`) and in the README
features list, so the repository is searchable too.

## Permission justifications

The dashboard asks for a justification per permission. These match the manifest:

| Permission | Justification |
| --- | --- |
| `activeTab` | Grants access to the current tab only after the user clicks the icon, the shortcut or the context-menu item, so the visible area can be captured. |
| `scripting` | Injects the selection overlay into that tab. |
| `storage` | Stores the user's own preferences (language, profile, layout, thresholds). No page data is stored. |
| `clipboardWrite` | Copies the recognised text to the clipboard, which is the point of the extension. |
| `contextMenus` | Adds the "QuickOCR: select an area to read" right-click entry. |
| `offscreen` | Runs the bundled WebAssembly OCR engine outside the page, because Manifest V3 service workers cannot host WebAssembly or workers. |
| `https://tessdata.projectnaptha.com/*` | Downloads an optional language model when the user asks for one. No user data is sent. |

## Data usage answers (Privacy tab)

* Single purpose: "Select an area of the screen and copy the text in it."
* Data collected: **none**. The extension does not transmit images, text, page
  content, identifiers or usage data.
* Sold to third parties: no. Used for purposes unrelated to the single purpose:
  no. Used for creditworthiness or lending: no.
* Privacy policy URL: host `privacy_policy.html` (it ships in the package) or
  point at the same file in the repository.

## Assets (already generated in `store/`)

| Asset | Size | Status |
| --- | --- | --- |
| Extension icon | 128x128 PNG in the ZIP | `icons/icon128.png` (art sized 100 px inside the 128 px canvas, store convention) |
| Small promo tile | 440x280 | `store/promo-small-tile-440x280.png` - **required**; listings without it are shown after those with it |
| Marquee promo tile | 1400x560 | `store/promo-marquee-1400x560.png` - optional, used for featuring |
| Screenshot: selection overlay | 1280x800 | `store/screenshot-1-selection-1280x800.png` |
| Screenshot: result card | 1280x800 | `store/screenshot-2-result-1280x800.png` |
| Screenshot: settings | 1280x800 | `store/screenshot-3-settings-1280x800.png` |
| Store icon for the dashboard | 128x128 | `store/icon-128.png` |

Screenshots must be full-bleed with square corners at 1280x800 or 640x400; the
files above are captured at exactly 1280x800 with `--force-device-scale-factor=1`.

## Publishing checklist

```bash
pnpm build          # bundles, copies static files, runs the readiness check
pnpm check          # same check on its own
pnpm zip            # writes quickocr.zip from dist/
```

1. Register in the [developer dashboard](https://chrome.google.com/webstore/devconsole)
   and pay the one-time fee.
2. Upload `quickocr.zip` (the manifest must be at the root of the ZIP - `pnpm zip`
   does that).
3. Fill the listing with the copy above, upload the promo tile and screenshots,
   add the category and language.
4. Paste the permission justifications and answer the Privacy tab questions.
5. Submit for review. Reviews typically take a few days; permission changes and
   anything that looks like remote code trigger a longer look.
6. After publishing, keep `version` in `manifest.json` and `package.json` in step
   for every release, and update `docs/store-listing.md` when the copy changes.

## Things that get submissions rejected

* Remote code: no `<script src="https://...">`, no `eval` of downloaded code.
  `scripts/check-store.mjs` fails the build if it finds any.
* Over-broad permissions or a `web_accessible_resources` list wider than needed.
* Keyword stuffing in the title, or a description that does not match behaviour.
* Missing or unreachable privacy policy when the extension touches user data -
  QuickOCR does not, but the policy is still required reading for reviewers.
