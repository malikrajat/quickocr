// Generate screenshot templates for Chrome Web Store
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const screenshotsDir = path.join(__dirname, '../screenshots');

// Create screenshots directory
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Screenshot specifications for Chrome Web Store
const screenshots = [
  {
    name: '1-selection-overlay',
    width: 1280,
    height: 800,
    title: 'Selection Overlay',
    description: 'Draw a rectangle around any text on screen',
  },
  {
    name: '2-result-window',
    width: 1280,
    height: 800,
    title: 'OCR Result',
    description: 'Extracted text with confidence score',
  },
  {
    name: '3-settings-page',
    width: 1280,
    height: 800,
    title: 'Settings',
    description: 'Configure language and preferences',
  },
  {
    name: '4-context-menu',
    width: 1280,
    height: 800,
    title: 'Context Menu',
    description: 'Right-click to activate OCR',
  },
  {
    name: '5-before-after',
    width: 1280,
    height: 800,
    title: 'Before and After',
    description: 'Image to text conversion',
  },
];

// Promotional image sizes
const promoImages = [
  { name: 'small-tile', width: 440, height: 280 },
  { name: 'large-tile', width: 920, height: 680 },
  { name: 'marquee', width: 1400, height: 560 },
];

async function generateTemplates() {
  console.log('Generating screenshot templates...\n');

  // Generate screenshot templates
  for (const screenshot of screenshots) {
    const outputPath = path.join(screenshotsDir, `${screenshot.name}.png`);
    
    // Create a template with text overlay
    const svg = `
      <svg width="${screenshot.width}" height="${screenshot.height}">
        <rect width="100%" height="100%" fill="#f0f0f0"/>
        <rect x="40" y="40" width="${screenshot.width - 80}" height="${screenshot.height - 80}" 
              fill="white" stroke="#007bff" stroke-width="4" rx="8"/>
        <text x="50%" y="45%" font-family="Arial" font-size="48" font-weight="bold" 
              fill="#333" text-anchor="middle">${screenshot.title}</text>
        <text x="50%" y="55%" font-family="Arial" font-size="24" 
              fill="#666" text-anchor="middle">${screenshot.description}</text>
        <text x="50%" y="65%" font-family="Arial" font-size="18" 
              fill="#999" text-anchor="middle">${screenshot.width}x${screenshot.height}</text>
      </svg>
    `;

    try {
      await sharp(Buffer.from(svg))
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Created ${screenshot.name}.png`);
    } catch (error) {
      console.error(`✗ Failed to create ${screenshot.name}:`, error.message);
    }
  }

  console.log('\nGenerating promotional image templates...\n');

  // Generate promotional image templates
  for (const promo of promoImages) {
    const outputPath = path.join(screenshotsDir, `promo-${promo.name}.png`);
    
    const svg = `
      <svg width="${promo.width}" height="${promo.height}">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#007bff;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#0056b3;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)"/>
        <text x="50%" y="40%" font-family="Arial" font-size="${promo.height * 0.12}" 
              font-weight="bold" fill="white" text-anchor="middle">OCR Selection</text>
        <text x="50%" y="55%" font-family="Arial" font-size="${promo.height * 0.06}" 
              fill="white" text-anchor="middle">Privacy-First Text Capture</text>
        <text x="50%" y="70%" font-family="Arial" font-size="${promo.height * 0.04}" 
              fill="rgba(255,255,255,0.8)" text-anchor="middle">Extract text from any screen area</text>
        <text x="50%" y="90%" font-family="Arial" font-size="${promo.height * 0.03}" 
              fill="rgba(255,255,255,0.6)" text-anchor="middle">${promo.width}x${promo.height}</text>
      </svg>
    `;

    try {
      await sharp(Buffer.from(svg))
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Created promo-${promo.name}.png (${promo.width}x${promo.height})`);
    } catch (error) {
      console.error(`✗ Failed to create promo-${promo.name}:`, error.message);
    }
  }

  console.log('\n✓ Screenshot templates generated!');
  console.log('\n📝 Next Steps:');
  console.log('1. Load the extension in Chrome');
  console.log('2. Take actual screenshots of each feature');
  console.log('3. Replace template files in screenshots/ folder');
  console.log('4. Ensure screenshots are 1280x800 or 640x400');
  console.log('5. Use promotional images for store listing');
  console.log('\n💡 Tips:');
  console.log('- Use high-quality, clear screenshots');
  console.log('- Show the extension in action');
  console.log('- Highlight key features');
  console.log('- Use consistent styling');
}

generateTemplates().catch(console.error);
