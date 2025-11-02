// test_rag.js
// Script untuk testing RAG handler
// Jalankan: npm run rag:test

import { localRAG, getRAGStatus } from './rag_handler.js';

async function testRAG() {
  console.log('🧪 Testing RAG System\n');
  
  // 1. Check RAG Status
  console.log('📊 RAG Status:');
  const status = getRAGStatus();
  console.log(JSON.stringify(status, null, 2));
  console.log('\n');
  
  if (!status.available) {
    console.error('❌ RAG tidak tersedia. Jalankan: npm run rag:index');
    process.exit(1);
  }
  
  // 2. Test queries
  const testQueries = [
    'Bagaimana cara membuat KTP?',
    'Apa itu SKCK?',
    'Dimana lokasi Disdukcapil?',
    'Cara perpanjang SIM online',
    'Opo kuwi SKCK',
    'Nopo niku STNK?'
  ];
  
  for (const query of testQueries) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`❓ QUERY: "${query}"`);
    console.log('='.repeat(80));
    
    const result = await localRAG(query);
    
    if (result.ok) {
      console.log(`\n✅ SUCCESS\n`);
      console.log(`📝 JAWABAN:\n${result.answer}\n`);
      console.log(`📚 SOURCES (${result.sources.length}):`);
      result.sources.forEach((source, i) => {
        console.log(`   ${i + 1}. [${(source.score * 100).toFixed(1)}%] ${source.text.substring(0, 60)}...`);
      });
      console.log(`\n🤖 Metadata:`, result.metadata);
    } else {
      console.log(`\n❌ FAILED: ${result.error}`);
      console.log(`💬 Message: ${result.message}`);
    }
    
    // Delay to avoid rate limit
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log('🎉 Testing selesai!');
  console.log('='.repeat(80));
}

testRAG().catch(console.error);
