require('dotenv').config(); // .env 파일의 API KEY 로드
const fs = require('fs');
const xlsx = require('xlsx');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

// --- 설정 ---
const EXCEL_FILE_PATH = './safety_data.xlsx'; // 엑셀 파일 이름
const TABLE_NAME = 'safety_rag_docs';         // 수파베이스 테이블 이름

// --- 클라이언트 초기화 ---
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GEMINI_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function main() {
    console.log(`📂 엑셀 파일(${EXCEL_FILE_PATH})을 읽고 있습니다...`);

    // 1. 엑셀 읽기
    let workbook;
    try {
        workbook = xlsx.readFile(EXCEL_FILE_PATH);
    } catch (e) {
        console.error("❌ 엑셀 파일을 찾을 수 없습니다. 파일명을 확인해주세요.");
        return;
    }
    
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet); // 엑셀 데이터를 JSON 배열로 변환

    console.log(`📊 총 ${data.length}개의 데이터를 발견했습니다.`);
    console.log("🚀 변환 및 업로드를 시작합니다...\n");

    const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

    let successCount = 0;
    let failCount = 0;

    // 2. 한 줄씩 처리 (Rate Limit 방지를 위해 for...of 사용)
    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const { category, question, context, source } = row;

        if (!question || !context) {
            console.log(`⚠️ [Skip] ${i+1}번째 줄: 질문(question)이나 내용(context)이 비어있습니다.`);
            failCount++;
            continue;
        }

        try {
            // 3. 질문(question)만 임베딩 생성! (핵심)
            const result = await embeddingModel.embedContent(question);
            const embedding = result.embedding.values;

            // 4. Supabase에 저장
            const { error } = await supabase
                .from(TABLE_NAME)
                .insert({
                    category: category || '일반',
                    question: question,
                    context: context,
                    source: source || '',
                    embedding: embedding
                });

            if (error) throw error;

            console.log(`✅ [${i+1}/${data.length}] 업로드 성공: ${question.substring(0, 20)}...`);
            successCount++;

            // API 속도 제한 방지를 위해 0.5초 대기 (Gemini 무료 티어 고려)
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (err) {
            console.error(`❌ [Error] ${i+1}번째 줄 처리 실패:`, err.message);
            failCount++;
        }
    }

    console.log(`\n---------------------------------------`);
    console.log(`🎉 완료! 성공: ${successCount}건, 실패: ${failCount}건`);
}

main();