const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function(event, context) {
  // 1. 통신 보안 설정
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const body = JSON.parse(event.body);
    const userMessage = body.message;

    // 2. 수파베이스 & 제미나이 연결 준비
    // (Netlify 환경변수에 저장한 키들을 가져옵니다)
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // 3. 사용자 질문을 숫자로 변환 (임베딩)
    // (이 모델은 검색용이라 004 버전을 써야 합니다. 건드리지 마세요!)
    const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const embeddingResult = await embeddingModel.embedContent(userMessage);
    const embedding = embeddingResult.embedding.values;

    // 4. 수파베이스에서 지식 검색 (우리가 만든 match_documents 함수 실행)
    const { data: documents, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.05, // 유사도 40% 이상인 것만 (너무 높으면 못 찾음)
      match_count: 3        // 가장 비슷한 3개만 가져오기
    });

    if (error) {
      console.error("Supabase 검색 에러:", error);
      // 에러 나도 챗봇이 죽지 않게 그냥 빈 정보로 진행
    }

    // 5. 찾아온 지식을 글자로 정리
    let contextText = "";
    if (documents && documents.length > 0) {
      contextText = documents.map(doc => 
        `[관련 규정]\n${doc.content}\n(출처: ${doc.metadata.source})`
      ).join("\n\n");
      console.log("✅ 지식 검색 성공:", documents.length, "개 찾음");
    } else {
      contextText = "관련된 정보가 데이터베이스에 없습니다.";
      console.log("⚠️ 지식 검색 결과 없음");
    }

    // 6. 제미나이에게 답변 요청
    // ⚠️ 중요: 아까 작동했던 그 모델 이름을 여기에 적으세요! (예: gemini-2.0-flash-exp)
    const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
    
    const prompt = `
      너는 건설공사 안전관리 종합정보망(CSI) AI 챗봇이야.
      아래 [검색된 지식]을 바탕으로 사용자의 질문에 '하십시오'체로 답변해.
      만약 [검색된 지식]에 답이 없으면 "죄송합니다. 해당 내용은 정보망 규정에서 찾을 수 없습니다."라고 솔직하게 말해.
      
      [검색된 지식]
      ${contextText}
      
      [사용자 질문]
      ${userMessage}
    `;

    const result = await chatModel.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return { statusCode: 200, body: JSON.stringify({ reply: text }) };

  } catch (error) {
    console.error("서버 에러:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "처리 중 오류가 발생했습니다." }) };
  }
};