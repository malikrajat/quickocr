# OCR Selection - Privacy-First Text Capture Extension

A Chrome extension that extracts text from screen selections using local OCR processing. Privacy-first design with all processing happening on your device.

## Features

- 🔒 **Privacy-First**: All OCR processing happens locally using WebAssembly
- 🎯 **Simple Interface**: Drag to select any screen area
- 🌍 **100+ Languages**: Support for multiple languages
- ⚡ **Fast & Accurate**: Choose between speed and accuracy
- 📋 **One-Click Copy**: Copy extracted text to clipboard instantly
- ⌨️ **Keyboard Shortcuts**: Esc to cancel, intuitive controls
- 🎨 **Draggable UI**: Move result window anywhere on screen
- 📊 **Confidence Scores**: See OCR accuracy for each extraction

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone [repository-url]
   cd ocr-selection-ext
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the extension:
   ```bash
   pnpm build
   ```

4. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist/` folder

### From Chrome Web Store

[Coming soon - link to Chrome Web Store]

## Usage

### Basic Usage

1. **Activate QuickOCR**:
   - Click the extension icon in the toolbar, OR
   - Press `Alt+Shift+O`, OR
   - Right-click the page and choose "QuickOCR: select an area to read"

2. **Select the area**:
   - Drag a rectangle over the text you want to read
   - Drag the handles to fine-tune it, or drag inside it to move it

3. **Read it**:
   - Click "Read text", or press `Enter`
   - The overlay takes itself off screen before the screenshot, so none of it can end up in the recognised image
   - Recognition runs locally; progress is shown at the top of the page

4. **Copy it**:
   - The text is copied to your clipboard as soon as it is recognised
   - The result card is editable, so misread characters can be fixed and copied again
   - "Download .txt" saves it, "Copy image" copies the crop, "Reselect" starts over

### Keyboard Shortcuts

- `Esc` - step back: cancel a running job, close the result, clear the selection, close the overlay
- `Enter` - read the current selection
- Arrow keys - nudge the selection (Shift = 20px, Alt = 1px)
- The result card is draggable by its header

### Pages that cannot be used

Chrome blocks extensions on pages such as `chrome://settings`, the Chrome Web Store and other extensions' pages. QuickOCR shows "N/A" on the toolbar badge there, and "!" when injection fails for any other reason.

## Settings

Open the settings page from `chrome://extensions` (Details -> Extension options), or accept the page that opens on first install.

### Document profile
What kind of content you normally select: `Auto`, `Document`, `Screenshot`, `Handwriting` or `Code`. This chooses the page segmentation mode and the preprocessing route.

### Layout preset
How recognised lines are stitched together: `Balanced` (paragraphs), `Verbatim` (keeps columns and spacing - best for tables and code) or `Compact` (merges wrapped lines).

### OCR language
English is built in and works offline out of the box. Any other language is downloaded once (2-15 MB), kept in your browser, and works offline afterwards.

### Confidence threshold
Results below this mean confidence are flagged in the result card (0-100, default 60).

### Image preprocessing
`Auto enhance` (upscales small text, inverts dark-mode captures), `Sharpen`, `Black & white` (adaptive threshold), `Grayscale` and `Contrast stretch`. The engine still tries several recipes and keeps the best result; these decide which ones are available.

### Clearing data
"Clear local data" deletes the settings and every downloaded language pack. The built-in English model stays.

## Permissions Explained

The extension requests minimal permissions:

| Permission | Why We Need It |
|------------|----------------|
| `activeTab` | Capture visible browser tab when you make a selection |
| `scripting` | Inject selection overlay when you activate OCR |
| `storage` | Save your preferences (language, settings) |
| `clipboardWrite` | Copy extracted text to clipboard |
| `contextMenus` | Add "QuickOCR: select an area to read" to the right-click menu |
| `offscreen` | Host the local OCR engine (WebAssembly + Web Worker) outside the page |
| `tessdata.projectnaptha.com` (host) | Download an optional language pack when you ask for one |

**We do NOT request**:
- Access to all websites (`<all_urls>`)
- Browsing history
- Personal data
- Background network access

## Privacy & Data Practices

### What We Store
- **User Settings Only**: Language preference, engine mode, confidence threshold
- **No Images**: We never store captured images
- **No OCR Results**: Extracted text is not persisted
- **No Tracking**: No analytics, no telemetry, no ads

### Local Processing
By default, all OCR happens in your browser:
- Tesseract.js runs as WebAssembly in your browser
- No data leaves your device
- Works completely offline
- No external API calls

### Language packs
The only network request the extension can make is a language pack download, and only when you click "Download pack" in the settings:
- Only the model file is fetched, from the pinned `tessdata.projectnaptha.com` source
- No image, recognised text or page content is part of that request
- English ships inside the extension, so English recognition never needs the network

See [Privacy Policy](privacy_policy.html) for full details.

## Troubleshooting

### OCR Not Working
- Ensure you've selected a clear area with visible text
- Try increasing the selection size
- Check that text has good contrast with background
- Switch to "Accurate" mode for better results

### Low Accuracy
- Use high-contrast, clear text
- Avoid rotated or skewed text
- Increase image size/resolution
- Select correct language in settings
- Try preprocessing: increase brightness/contrast

### Extension Not Loading
- Check Chrome version (requires Chrome 88+)
- Ensure all files are in dist/ folder
- Check browser console for errors
- Try rebuilding: `pnpm build`

### The overlay does not appear
- Chrome refuses injection on `chrome://` pages, the Chrome Web Store and other extensions' pages - the toolbar badge shows "N/A" there
- Any other injection failure shows "!" on the badge
- Otherwise check `chrome://extensions` -> QuickOCR -> Errors for details

### "The window switched to another tab"
- The screenshot has to be of the tab the selection was drawn in. Bring that tab back to the front and press "Read text" again

### Cannot Copy to Clipboard
- Check clipboard permissions in Chrome settings
- Try the fallback copy method (automatic)
- Manually select and copy text from result window

## Development

### Project Structure
```
quickocr/
├── src/
│   ├── service-worker.ts       # Toolbar/context-menu/shortcut entry, capture, offscreen owner
│   ├── offscreen.ts            # OCR host that owns the Tesseract worker
│   ├── content/selection.ts    # Injected selection overlay and result card
│   ├── settings/               # Options page
│   └── lib/                    # engine, imaging, layout, language store, protocol, types
├── icons/                      # Extension icons
├── scripts/                    # Build, watch, pack and test scripts
├── manifest.json               # Extension manifest (MV3)
├── vite.config.ts              # Bundles service worker, offscreen host and settings page (ESM)
├── vite.content.config.ts      # Bundles the content script as one classic-script IIFE
└── dist/                       # Built extension (generated)
```

### Build Commands

```bash
# Install dependencies
pnpm install

# Build for production
pnpm build

# Rebuild both bundles while you work
pnpm dev

# Run the OCR accuracy test
pnpm test

# Zip dist/ for the Chrome Web Store
pnpm pack
```

`pnpm build` copies the static files and the Tesseract runtime into `dist/`. The English model is taken from `scripts/.cache/eng.traineddata.gz` when it is there, so an offline build works; otherwise it is downloaded once and cached in that folder.

### Testing

1. Create a `test-images/` folder
2. Add sample images with known text
3. List them in `scripts/test-ocr.js`
4. Run: `pnpm test`

### Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Known Limitations

### Browser Tab Capture Only
- Chrome extensions can only capture browser tab content by default
- Cannot capture desktop or other applications without screen-share permission
- For full desktop capture, use native messaging host (advanced)

### Service Worker Lifetime
- MV3 service workers have limited lifetime
- Heavy OCR processing offloaded to web workers
- May need to reactivate for long sessions

### Language Data Size
- Each language pack is ~2-4 MB
- Downloaded on first use
- Cached for subsequent uses
- Consider bundle size for multiple languages

## Accuracy Tips

### Image Preprocessing
For best results:
- Use high-contrast text (black on white ideal)
- Ensure text is horizontal (not rotated)
- Avoid blurry or low-resolution images
- Remove noise and artifacts
- Increase brightness if text is faint

### Language Selection
- Always select the correct language
- Use language-specific models for best accuracy
- Some languages have "fast" and "best" variants

### Multi-Stage Recognition
- Quick pass for speed, then high-res if confidence is low
- Adjust confidence threshold based on use case
- Review and correct low-confidence results

## Chrome Web Store Compliance

This extension complies with:
- Chrome Web Store Developer Program Policies
- Manifest V3 requirements
- Privacy and security best practices
- No remote code execution
- Minimal permissions
- Clear privacy policy

## License

[Specify your license - e.g., MIT, Apache 2.0]

## Support

- **Email**: [your-email@example.com]
- **Issues**: [GitHub Issues URL]
- **Privacy**: See [Privacy Policy](privacy_policy.md)

## Changelog

### Version 1.0.0 (Initial Release)
- Local OCR processing with Tesseract.js
- Drag-to-select interface
- Multi-language support
- Fast and accurate modes
- Clipboard integration
- Privacy-first design
- Chrome MV3 compliant

## Acknowledgments

- [Tesseract.js](https://tesseract.projectnaptha.com/) - OCR engine
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) - Original OCR engine
- Chrome Extensions team for MV3 platform

---

Made with ❤️ for privacy-conscious users
