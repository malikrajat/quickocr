// Post-build script to copy static files to dist
const fs = require('fs');
const path = require('path');

const copyDir = (src, dest) => {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

const copyFile = (src, dest) => {
  fs.copyFileSync(src, dest);
};

// Copy manifest
copyFile('manifest.json', 'dist/manifest.json');

// Copy icons
copyDir('icons', 'dist/icons');

// Copy settings HTML
copyFile('src/settings/settings.html', 'dist/settings.html');

// Copy offscreen HTML
copyFile('src/offscreen.html', 'dist/offscreen.html');

// Copy OCR sandbox HTML
copyFile('src/ocr-sandbox.html', 'dist/ocr-sandbox.html');

// Copy Tesseract.js files
if (!fs.existsSync('dist/tesseract')) {
  fs.mkdirSync('dist/tesseract', { recursive: true });
}
if (!fs.existsSync('dist/tesseract/lang-data')) {
  fs.mkdirSync('dist/tesseract/lang-data', { recursive: true });
}

// Copy worker and core files
copyFile('node_modules/tesseract.js/dist/worker.min.js', 'dist/tesseract/worker.min.js');
copyFile('node_modules/tesseract.js-core/tesseract-core.wasm.js', 'dist/tesseract/tesseract-core.wasm.js');

// Download English language data
const https = require('https');
const langUrl = 'https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz';
const langFile = 'dist/tesseract/lang-data/eng.traineddata.gz';

console.log('Downloading English language data...');
https.get(langUrl, (response) => {
  const file = fs.createWriteStream(langFile);
  response.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log('Language data downloaded');
  });
}).on('error', (err) => {
  console.error('Failed to download language data:', err.message);
});

console.log('Build complete! Extension files are in dist/');
console.log('\nTo load in Chrome:');
console.log('1. Open chrome://extensions/');
console.log('2. Enable "Developer mode"');
console.log('3. Click "Load unpacked"');
console.log('4. Select the dist/ folder');
