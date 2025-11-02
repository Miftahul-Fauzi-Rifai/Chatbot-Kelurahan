require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.GEMINI_API_KEY;

console.log('\n======================================================================');
console.log('📋 LISTING ALL AVAILABLE GEMINI MODELS');
console.log('======================================================================\n');

async function listModels() {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;
        
        console.log('📡 Fetching models from Google AI...\n');
        
        const response = await axios.get(url);
        
        const models = response.data.models || [];
        
        console.log(`✅ Found ${models.length} models\n`);
        console.log('======================================================================');
        console.log('MODELS THAT SUPPORT generateContent (chat):');
        console.log('======================================================================\n');
        
        const chatModels = models.filter(model => 
            model.supportedGenerationMethods && 
            model.supportedGenerationMethods.includes('generateContent')
        );
        
        chatModels.forEach((model, index) => {
            console.log(`${index + 1}. ${model.name}`);
            console.log(`   Display Name: ${model.displayName || 'N/A'}`);
            console.log(`   Description: ${model.description || 'N/A'}`);
            console.log(`   Methods: ${model.supportedGenerationMethods.join(', ')}`);
            console.log('');
        });
        
        console.log('======================================================================');
        console.log('💡 RECOMMENDED MODELS TO USE:');
        console.log('======================================================================\n');
        
        // Find the best models
        const recommended = chatModels.filter(m => 
            m.name.includes('flash') || 
            m.name.includes('pro')
        );
        
        recommended.forEach((model, index) => {
            // Extract just the model name without "models/" prefix
            const modelName = model.name.replace('models/', '');
            console.log(`${index + 1}. ${modelName}`);
        });
        
        console.log('\n======================================================================');
        console.log('📝 UPDATE YOUR .env FILE:');
        console.log('======================================================================\n');
        
        if (recommended.length > 0) {
            const bestModel = recommended[0].name.replace('models/', '');
            console.log(`GEMINI_MODEL=${bestModel}`);
        }
        
        console.log('\n✅ Done!\n');
        
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        
        if (error.response) {
            console.error('\nStatus:', error.response.status);
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

listModels();
