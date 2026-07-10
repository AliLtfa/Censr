<img width="128" height="128" alt="icon128" src="https://github.com/user-attachments/assets/fa41087e-d774-4f55-8d8e-23ea571adec0" />


# Censr - Browser Extension

An AI-powered browser extension that automatically detects and censors NSFW content in **images, GIFs, and videos** on any webpage using NudeNet (YOLOv8-based model).

## Features

- 🛡️ **Real-time Detection**: Automatically scans images, GIFs, and videos as pages load
- 🎬 **Video Support**: Censors video content in real-time (HTML5, HLS, canvas-based players)
- 🎞️ **GIF Support**: Animated GIFs are processed frame-by-frame
- 🔒 **Placeholder Blur**: Content is blurred while being processed (no NSFW flash)
- 🎛️ **Customizable Censoring**: Toggle which body parts to censor
- 🎨 **Multiple Censor Styles**: Choose between Blur, Black Bar, or Pixelate
- 🏷️ **Custom Labels**: Replace detection labels with your own text or emojis (or hide them!)
- 🖼️ **Image Overlays**: Use custom images instead of blur/bars (stickers, memes, etc.)
- 📏 **Box Size Multiplier**: Make censored areas larger (1x to 3x)
- ⏱️ **Frame Interval Control**: Adjust video/GIF processing speed (50-500ms)
- 🔒 **Privacy-Focused**: All processing happens locally in your browser
- ⚡ **Fast**: Uses ONNX Runtime WebAssembly for efficient inference

## Video Player Support

The extension supports multiple video player types:
- **Standard HTML5 `<video>`** - YouTube, Vimeo, most sites
- **Canvas-based players** - HLS.js, Dash.js, many streaming sites
- **Adaptive streaming** - Sites using .ts segments, .m3u8 playlists
- **Shadow DOM** - Videos hidden in web components
- **Blob URLs** - Videos loaded via blob: URLs

## Custom Labels

You can customize the text displayed on censored regions by enabling "Use custom label text" in settings and entering your desired custom labels for each part.

## Custom Image Overlays

Instead of blur/black/pixelate, you can use custom images:

1. Enable "Use images instead of blur/black" in settings
2. Add image URLs (one per line):

```
https://example.com/censored-sticker.png
https://example.com/funny-meme.jpg
data:image/png;base64,iVBORw0KGgo...
```

A random image from your list will be chosen for each detected region.

**Tips:**
- Use PNG images for best results
- Square images work best (they'll be stretched to fit)
- You can use data URIs for local images


## Installation

### Chrome / Edge / Brave (Chromium-based browsers)

1. Download and unzip the extension
2. Open your browser and go to `chrome://extensions/` (or `edge://extensions/` for Edge)
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the unzipped `nsfw-censor-extension` folder
6. The extension icon should appear in your toolbar

### Firefox

 This extension may be used for FireFox (both mobile and web) by directly downloading it from the extension store.

## Usage

1. **Click the extension icon** in your toolbar to open the settings popup
2. **Enable/Disable**: Use the master toggle to turn the extension on/off
3. **Select Labels**: Choose which content types to censor by toggling individual labels
4. **Censor Style**: Choose how to censor detected content:
   - **Blur** - Blurs the detected region (default)
   - **Black Bar** - Solid black rectangle
   - **Pixelate** - Mosaic/pixelated effect
5. **Adjust Confidence**: Use the slider to set detection sensitivity (lower = more sensitive)
6. **Quick Actions**:
   - "Select All" - Enable all labels
   - "Exposed Only" - Enable only exposed content labels
   - "Clear All" - Disable all labels
7. **Rescan Page**: Click to manually re-scan all images/videos on the current page

## How It Works

### Images
1. When images load, they're immediately blurred as a placeholder
2. Each image is preprocessed and run through the NudeNet model
3. Once detection completes, the blur is replaced with precise censoring
4. Results are cached to avoid re-processing

### Videos
1. Videos are monitored for playback events
2. While playing, frames are captured every 200ms
3. Each frame is analyzed and censorship is overlaid in real-time
4. Censorship follows detected regions as they move

## Technical Details

- **Model**: NudeNet v3 (YOLOv8 Nano, 320x320 input)
- **Runtime**: ONNX Runtime Web (WebAssembly backend)
- **Model Size**: ~12MB
- **ONNX Runtime**: ~19MB (bundled, not loaded from CDN)
- **Processing**: ~100-500ms per image depending on hardware
- **Architecture**: Uses Chrome's Offscreen Documents API to bypass Content Security Policy restrictions on websites

## Privacy

- All image processing happens **locally in your browser**
- No images or data are sent to external servers
- No analytics or tracking

## Troubleshooting

**Extension not working on a page?**
- Some pages with strict Content Security Policy may block the ONNX runtime
- Try clicking "Rescan Page" in the popup
- Refresh the page after enabling the extension

**Images not being censored?**
- Check that the extension is enabled (green toggle)
- Verify you have labels selected for censoring
- Try lowering the confidence threshold
- Check browser console for errors

**High CPU usage?**
- The extension is designed to be extremely lightweight, processeing images one at a time to minimize impact
- Processing is more intensive on pages with many large images
- Consider disabling on specific sites if needed

## Building from Source

This extension doesn't require a build step - it's plain JavaScript that runs directly in the browser. Just load the folder as an unpacked extension. Use the release versions to load with the icons.

## Credits

- [NudeNet](https://github.com/notai-tech/nudenet) - NSFW detection model
- [Hyuto/yolov8-onnxruntime-web](https://github.com/Hyuto/yolov8-onnxruntime-web) - YOLOv8 ONNX web implementation
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) - ML inference engine

## License

MIT License - Feel free to modify and distribute.

## Disclaimer

This extension is provided for content filtering purposes. Detection accuracy is not 100% - some content may be missed or incorrectly flagged. Use responsibly.
