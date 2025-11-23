// Test OCR accuracy with sample images
const { createWorker } = require('tesseract.js');
const fs = require('fs');
const path = require('path');

const testCases = [
  {
    name: 'Sample Text 1',
    imagePath: 'test-images/sample1.png',
    expectedText: 'Hello World',
  },
  // Add more test cases as needed
];

async function runTests() {
  console.log('Starting OCR accuracy tests...\n');
  
  const worker = await createWorker('eng');
  let totalTests = 0;
  let passedTests = 0;

  for (const testCase of testCases) {
    const imagePath = path.join(__dirname, '..', testCase.imagePath);
    
    if (!fs.existsSync(imagePath)) {
      console.log(`⚠️  Skipping ${testCase.name}: Image not found`);
      continue;
    }

    totalTests++;
    console.log(`Testing: ${testCase.name}`);
    
    try {
      const { data } = await worker.recognize(imagePath);
      const extractedText = data.text.trim();
      const confidence = data.confidence;
      
      const matches = extractedText.includes(testCase.expectedText);
      
      if (matches) {
        passedTests++;
        console.log(`✓ PASS (${confidence.toFixed(1)}% confidence)`);
      } else {
        console.log(`✗ FAIL (${confidence.toFixed(1)}% confidence)`);
        console.log(`  Expected: "${testCase.expectedText}"`);
        console.log(`  Got: "${extractedText}"`);
      }
    } catch (error) {
      console.log(`✗ ERROR: ${error.message}`);
    }
    
    console.log('');
  }

  await worker.terminate();

  console.log(`\nResults: ${passedTests}/${totalTests} tests passed`);
  
  if (totalTests === 0) {
    console.log('\nNo test images found. Create test-images/ folder and add sample images.');
  }
}

runTests().catch(console.error);
