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

3. Create icons:
   ```bash
   pnpm create-icons
   ```
   Then open `icons/create-icons.html` in a browser and save each canvas as PNG.

4. Build the extension:
   ```bash
   pnpm build
   ```

5. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist/` folder

### From Chrome Web Store

[Coming soon - link to Chrome Web Store]

## Usage

### Basic Usage

1. **Activate OCR Selection**:
   - Click the extension icon in toolbar, OR
   - Right-click on page and select "OCR Selection"

2. **Select Area**:
   - Draw a rectangle around the text you want to extract
   - Use mouse to drag and create selection

3. **Capture**:
   - Click "Capture" button to process the selection
   - Wait for OCR to complete (1-8 seconds depending on mode)

4. **Copy Text**:
   - Click "Copy" to copy extracted text to clipboard
   - Or manually select and copy from result window

5. **Recapture** (if needed):
   - Click "Recapture" to select a different area
   - Adjust selection and try again

### Keyboard Shortcuts

- `Esc` - Cancel selection and close overlay
- Result window is draggable by clicking and dragging the header

## Settings

Access settings by clicking the extension icon and selecting "Settings":

### OCR Language
Choose the language for text recognition:
- English (default)
- Spanish, French, German, Italian, Portuguese
- Chinese (Simplified & Traditional), Japanese, Korean
- Arabic, Hindi, Russian
- 100+ more languages available

### Engine Mode
- **Fast**: Quicker processing (~1-3 seconds), good accuracy (85-95%)
- **Accurate**: Slower processing (~3-8 seconds), higher accuracy (90-98%)

### Confidence Threshold
Set minimum confidence level (0-100%) for accepting OCR results.

### Cloud OCR (Optional)
- **Disabled by default** for privacy
- Enable for potentially higher accuracy
- Requires explicit consent
- Images sent to server are immediately deleted after processing

## Permissions Explained

The extension requests minimal permissions:

| Permission | Why We Need It |
|------------|----------------|
| `activeTab` | Capture visible browser tab when you make a selection |
| `scripting` | Inject selection overlay when you activate OCR |
| `storage` | Save your preferences (language, settings) |
| `clipboardWrite` | Copy extracted text to clipboard |
| `contextMenus` | Add "OCR Selection" to right-click menu |

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

### Optional Cloud OCR
If you enable cloud OCR (opt-in only):
- Explicit consent required before any data is sent
- Only selected image region is uploaded
- Images are processed and immediately deleted
- No retention of images or results
- Can be disabled at any time

See [Privacy Policy](privacy_policy.md) for full details.

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

### Capture Button Not Appearing
- Ensure you've drawn a rectangle (minimum 20x20 pixels)
- Check that overlay is visible
- Try refreshing the page and reactivating

### Cannot Copy to Clipboard
- Check clipboard permissions in Chrome settings
- Try the fallback copy method (automatic)
- Manually select and copy text from result window

## Development

### Project Structure
```
ocr-selection-ext/
├── src/
│   ├── service-worker.ts       # Background service worker
│   └── content/
│       └── selection.ts        # Content script with overlay UI
├── icons/                      # Extension icons
├── scripts/                    # Build and utility scripts
├── manifest.json              # Extension manifest (MV3)
├── vite.config.ts            # Build configuration
└── dist/                     # Built extension (generated)
```

### Build Commands

```bash
# Install dependencies
pnpm install

# Create icon files
pnpm create-icons

# Build for production
pnpm build

# Build with watch mode (development)
pnpm dev

# Run OCR accuracy tests
pnpm test

# Pack for Chrome Web Store
pnpm pack
```

### Testing

1. Create `test-images/` folder
2. Add sample images with known text
3. Update `scripts/test-ocr.js` with test cases
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
