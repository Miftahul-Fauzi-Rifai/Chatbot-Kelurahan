// test_api.js
// Script untuk test backend API

import axios from 'axios';

const API_URL = 'http://localhost:3000';

console.log('🧪 Testing Chatbot Kelurahan API\n');

// Test 1: Root endpoint
async function testRoot() {
  console.log('1️⃣ Testing GET / ...');
  try {
    const response = await axios.get(`${API_URL}/`);
    console.log('   ✅ Success:', response.data.service);
    console.log('   Version:', response.data.version);
  } catch (error) {
    console.error('   ❌ Error:', error.message);
  }
}

// Test 2: Health check
async function testHealth() {
  console.log('\n2️⃣ Testing GET /health ...');
  try {
    const response = await axios.get(`${API_URL}/health`);
    console.log('   ✅ Status:', response.data.status);
    console.log('   Checks:', response.data.checks);
  } catch (error) {
    console.error('   ❌ Error:', error.message);
  }
}

// Test 3: Status
async function testStatus() {
  console.log('\n3️⃣ Testing GET /status ...');
  try {
    const response = await axios.get(`${API_URL}/status`);
    console.log('   ✅ Server:', response.data.server);
    console.log('   Rate Limit:', response.data.rateLimit);
    console.log('   Data Items:', response.data.data.items);
  } catch (error) {
    console.error('   ❌ Error:', error.message);
  }
}

// Test 4: Chat endpoint
async function testChat(message) {
  console.log(`\n4️⃣ Testing POST /chat with message: "${message}"`);
  try {
    const startTime = Date.now();
    const response = await axios.post(`${API_URL}/chat`, {
      message: message,
      history: []
    });
    const duration = Date.now() - startTime;
    
    if (response.data.ok) {
      const answer = response.data.output.candidates[0].content.parts[0].text;
      console.log('   ✅ Success!');
      console.log('   Model:', response.data.model);
      console.log('   Duration:', duration + 'ms');
      console.log('   Answer length:', answer.length, 'chars');
      console.log('   Answer preview:', answer.substring(0, 100) + '...');
    } else {
      console.error('   ❌ Error:', response.data.error);
    }
  } catch (error) {
    console.error('   ❌ Error:', error.message);
    if (error.response) {
      console.error('   Response:', error.response.data);
    }
  }
}

// Test 5: CORS
async function testCORS() {
  console.log('\n5️⃣ Testing CORS headers ...');
  try {
    const response = await axios.get(`${API_URL}/health`, {
      headers: {
        'Origin': 'https://example.com'
      }
    });
    const corsHeader = response.headers['access-control-allow-origin'];
    if (corsHeader === '*' || corsHeader === 'https://example.com') {
      console.log('   ✅ CORS is enabled:', corsHeader);
    } else {
      console.log('   ⚠️  CORS header:', corsHeader);
    }
  } catch (error) {
    console.error('   ❌ Error:', error.message);
  }
}

// Run all tests
async function runTests() {
  await testRoot();
  await testHealth();
  await testStatus();
  await testCORS();
  
  // Chat tests
  await testChat('Bagaimana cara membuat KTP?');
  await testChat('Jam kerja kelurahan?');
  await testChat('Alamat Disdukcapil?');
  
  console.log('\n✅ All tests completed!\n');
}

runTests().catch(error => {
  console.error('\n❌ Test suite failed:', error);
  process.exit(1);
});
