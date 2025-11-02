/**
 * Check Gemini API Quota and Status
 * Run: node check_quota.js
 */

const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;
const MODELS = [
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash'
];

async function checkQuota() {
    console.log('\n🔍 Checking Gemini API Status...\n');
    console.log('API Key:', API_KEY ? 
        API_KEY.substring(0, 20) + '...' : '❌ NOT FOUND');
    console.log('\n' + '='.repeat(60) + '\n');
    
    // Test both models
    for (const model of MODELS) {
        console.log(`📊 Testing: ${model}`);
        await testModel(model);
        console.log('');
    }
    
    console.log('='.repeat(60));
    console.log('\n📋 Rate Limits Summary (Free Tier):');
    console.log('   • Requests Per Minute (RPM): 15');
    console.log('   • Tokens Per Minute (TPM): 1,000,000');
    console.log('   • Requests Per Day (RPD): 1,500');
    console.log('\n💡 Tips:');
    console.log('   - Jika error 429: Tunggu 1 menit dan coba lagi');
    console.log('   - Jika quota habis: Server otomatis fallback ke local RAG');
    console.log('   - Check status: http://localhost:3000/api/status\n');
}

async function testModel(modelName) {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`;
        
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
        
        const startTime = Date.now();
        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });
        const endTime = Date.now();
        
        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        console.log('   ✅ Status: WORKING');
        console.log('   ⏱️  Response Time:', (endTime - startTime) + 'ms');
        console.log('   📝 Response:', text.substring(0, 50) + '...');
        
    } catch (error) {
        const statusCode = error.response?.status;
        const errorMsg = error.response?.data?.error?.message || error.message;
        
        console.log('   ❌ Status: ERROR');
        
        if (statusCode === 429 || errorMsg.includes('RESOURCE_EXHAUSTED')) {
            console.log('   🚫 Error: RATE LIMIT / QUOTA EXCEEDED');
            console.log('   💡 Solution: Tunggu 1 menit, atau server akan auto-fallback ke local RAG');
        } else if (statusCode === 400 && errorMsg.includes('API key')) {
            console.log('   🔑 Error: INVALID API KEY');
            console.log('   💡 Solution: Check .env file Anda');
        } else if (statusCode === 404) {
            console.log('   🔍 Error: MODEL NOT FOUND');
            console.log('   💡 Solution: Model mungkin belum tersedia di region Anda');
        } else {
            console.log('   ❓ Error:', errorMsg);
        }
    }
}

// Run check
checkQuota().catch(console.error);
