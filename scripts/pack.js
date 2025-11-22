// Pack extension for Chrome Web Store
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const distDir = path.join(__dirname, '../dist');
const outputZip = path.join(__dirname, '../ocr-selection-ext.zip');

if (!fs.existsSync(distDir)) {
  console.error('Error: dist/ folder not found. Run "pnpm build" first.');
  process.exit(1);
}

try {
  // Use PowerShell to create zip on Windows
  const command = `Compress-Archive -Path "${distDir}\\*" -DestinationPath "${outputZip}" -Force`;
  execSync(command, { shell: 'powershell.exe' });
  console.log(`Extension packed: ${outputZip}`);
  console.log('Ready for Chrome Web Store upload!');
} catch (error) {
  console.error('Failed to create zip:', error.message);
  process.exit(1);
}
