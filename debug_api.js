/**
 * DEBUG SCRIPT - Check Why Gemini API Always Fails
 * Run: node debug_api.js
 */

require('dotenv').config();
const axios = require('axios');

async function debugGeminiAPI() {
  console.log('\n' + '='.repeat(70));
  console.log('🔍 DEBUGGING GEMINI API - Why "AI sedang sibuk"?');
  console.log('='.repeat(70) + '\n');
  
  // Step 1: Check API Key
  console.log('📋 STEP 1: Checking API Key...\n');
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.error('❌ CRITICAL: GEMINI_API_KEY not found in .env file!');
    console.log('\n💡 Solution:');
    console.log('   1. Open .env file');
    console.log('   2. Add: GEMINI_API_KEY=your_api_key_here');
    console.log('   3. Get API key from: https://aistudio.google.com/app/apikey\n');
    return;
  }
  
  console.log('✅ API Key found');
  console.log(`   Key: ${apiKey.substring(0, 20)}...${apiKey.substring(apiKey.length - 5)}`);
  console.log(`   Length: ${apiKey.length} characters`);
  console.log('');
  
  // Step 2: Test Models
  console.log('📋 STEP 2: Testing Models...\n');
  
  const models = [
    { name: 'gemini-2.0-flash-exp', description: 'Primary (Fast, Experimental)' },
    { name: 'gemini-2.5-flash', description: 'Fallback 1 (Newest Stable - June 2025)' },
    { name: 'gemini-2.0-flash', description: 'Fallback 2 (Stable Alternative)' }
  ];
  
  let successCount = 0;
  let workingModel = null;
  
  for (const model of models) {
    try {
      console.log(`🧪 Testing: ${model.name}`);
      console.log(`   Description: ${model.description}`);
      
      // Dynamic API version selection (same as server.js)
      const apiVersion = model.name.includes('2.0') || model.name.includes('exp') ? 'v1beta' : 'v1';
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model.name}:generateContent?key=${apiKey}`;
      
      console.log(`   🔗 Endpoint: ${apiVersion} (${model.name.includes('2.0') || model.name.includes('exp') ? 'experimental' : 'stable'})`);
      
      const payload = {
        contents: [{
          role: "user",
          parts: [{ text: "Halo, test API" }]
        }],
        generationConfig: {
          maxOutputTokens: 50,
          temperature: 0.7
        }
      };
      
      console.log(`   📡 Sending request...`);
      const startTime = Date.now();
      
      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      
      const duration = Date.now() - startTime;
      const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || 'No text';
      
      console.log(`   ✅ SUCCESS! (${duration}ms)`);
      console.log(`   📝 Response: "${text.substring(0, 80)}..."`);
      console.log('');
      
      successCount++;
      if (!workingModel) workingModel = model.name;
      
    } catch (error) {
      const statusCode = error.response?.status;
      const errorMsg = error.response?.data?.error?.message || error.message;
      const errorCode = error.response?.data?.error?.code;
      const errorStatus = error.response?.data?.error?.status;
      
      console.log(`   ❌ FAILED`);
      console.log(`   Status Code: ${statusCode || 'N/A'}`);
      console.log(`   Error Code: ${errorCode || 'N/A'}`);
      console.log(`   Error Status: ${errorStatus || 'N/A'}`);
      console.log(`   Error Message: ${errorMsg}`);
      
      // Detailed error analysis
      if (statusCode === 400) {
        console.log(`   💡 Solution: API key invalid or model not available`);
        console.log(`      - Get new API key: https://aistudio.google.com/app/apikey`);
        console.log(`      - Check if model name is correct`);
      } else if (statusCode === 403) {
        console.log(`   💡 Solution: API key doesn't have permission`);
        console.log(`      - Check API key restrictions`);
        console.log(`      - Enable Gemini API in Google Cloud Console`);
      } else if (statusCode === 404) {
        console.log(`   💡 Solution: Model not found in your region`);
        console.log(`      - Model might not be available yet`);
        console.log(`      - Try alternative model name`);
      } else if (statusCode === 429) {
        console.log(`   💡 Solution: Quota exceeded (rate limit or daily limit)`);
        console.log(`      - Wait 1 minute for rate limit reset`);
        console.log(`      - Wait until tomorrow 14:00 WIB for daily reset`);
      } else if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('ECONNREFUSED')) {
        console.log(`   💡 Solution: Network/DNS issue`);
        console.log(`      - Check internet connection`);
        console.log(`      - Try different network`);
        console.log(`      - Check firewall/proxy settings`);
      } else if (errorMsg.includes('timeout')) {
        console.log(`   💡 Solution: Request timeout`);
        console.log(`      - Internet too slow`);
        console.log(`      - Try again`);
      }
      
      console.log('');
      
      // Show full error for debugging
      if (error.response?.data) {
        console.log(`   📄 Full Error Response:`);
        console.log(`   ${JSON.stringify(error.response.data, null, 2)}`);
        console.log('');
      }
    }
  }
  
  // Step 3: Summary
  console.log('='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70) + '\n');
  
  console.log(`Models tested: ${models.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${models.length - successCount}\n`);
  
  if (successCount === 0) {
    console.log('❌ ALL MODELS FAILED! This is why you see "AI sedang sibuk"\n');
    console.log('🔧 TROUBLESHOOTING STEPS:\n');
    console.log('1. Check your .env file:');
    console.log('   - Make sure GEMINI_API_KEY exists');
    console.log('   - No spaces around the = sign');
    console.log('   - No quotes around the key\n');
    console.log('2. Verify API key:');
    console.log('   - Visit: https://aistudio.google.com/app/apikey');
    console.log('   - Check if key is still active');
    console.log('   - Generate new key if needed\n');
    console.log('3. Check quota:');
    console.log('   - Free tier: 15 req/min, 1,500 req/day');
    console.log('   - Wait for reset if exceeded\n');
    console.log('4. Check network:');
    console.log('   - Test internet connection');
    console.log('   - Disable firewall/VPN temporarily\n');
  } else if (successCount === 1) {
    console.log(`⚠️ Only ${successCount} model working: ${workingModel}\n`);
    console.log('💡 RECOMMENDATION:\n');
    console.log(`Update your .env file to use the working model:`);
    console.log(`GEMINI_MODEL=${workingModel}\n`);
  } else {
    console.log(`✅ ${successCount} models working! API is healthy!\n`);
    console.log('💡 Your chatbot should work fine now.\n');
    console.log('If still seeing "AI sedang sibuk", check server logs for actual errors.\n');
  }
  
  // Step 4: Check .env configuration
  console.log('='.repeat(70));
  console.log('📋 CURRENT .ENV CONFIGURATION');
  console.log('='.repeat(70) + '\n');
  
  console.log(`GEMINI_API_KEY: ${apiKey ? '✅ Set' : '❌ Not set'}`);
  console.log(`GEMINI_MODEL: ${process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp (default)'}`);
  console.log(`PORT: ${process.env.PORT || '3000 (default)'}`);
  console.log(`API_TIMEOUT: ${process.env.API_TIMEOUT || '30000 (default)'}`);
  console.log('');
  
  console.log('='.repeat(70));
  console.log('✅ Debug completed!');
  console.log('='.repeat(70) + '\n');
}

// Run the debug
debugGeminiAPI().catch(error => {
  console.error('\n❌ Fatal error during debug:');
  console.error(error);
});
