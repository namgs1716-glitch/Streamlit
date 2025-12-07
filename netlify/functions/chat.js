const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function(event, context) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const body = JSON.parse(event.body);
    const userMessage = body.message;

    // 1. 연결 설정
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // 2. 질문 임베딩
    const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const embeddingResult = await embeddingModel.embedContent(userMessage);
    const embedding = embeddingResult.embedding.values;

    // 3. 수파베이스 검색 (🔥 50개까지 넉넉하게 가져옴)
    const { data: documents, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.1, 
      match_count: 50  // 10개 -> 50개로 대폭 늘림
    });

    if (error) console.error("Supabase Error:", error);

    // 4. 🔥 [핵심] 리랭킹 (Re-ranking): 질문 키워드가 있는 문서를 1등으로 올리기
    let finalDocs = [];
    if (documents && documents.length > 0) {
        // 질문을 단어로 쪼갭니다 (예: "건설사고", "신고", "시간")
        const keywords = userMessage.split(" ").filter(w => w.length > 1);
        
        // 각 문서에 점수를 매깁니다
        documents.forEach(doc => {
            doc.score = 0;
            keywords.forEach(word => {
                // 문서 내용에 질문의 단어가 포함되어 있으면 점수 추가!
                if (doc.content.includes(word)) {
                    doc.score += 1; 
                }
            });
        });

        // 점수 높은 순서(키워드 많은 순)로 다시 정렬
        documents.sort((a, b) => b.score - a.score);

        // 상위 5개만 최종 선택
        finalDocs = documents.slice(0, 5);
    }

    // 5. 컨텍스트 정리
    let contextText = "";
    if (finalDocs.length > 0) {
      contextText = finalDocs.map((doc, idx) => 
        `[문서${idx+1}] (키워드매칭점수: ${doc.score})\n${doc.content}`
      ).join("\n\n");
    } else {
      contextText = "관련된 정보가 없습니다.";
    }

    // 6. Gemini 답변 생성
    // (성공했던 모델 이름 유지하세요. 예: gemini-2.0-flash-exp 등)
    const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
    
    const prompt = `
      너는 건설공사 안전관리 챗봇이야.
      반드시 아래 [제공된 문서]에 있는 내용만을 바탕으로 답변해.
      
      [제공된 문서]
      ${contextText}
      
      [사용자 질문]
      ${userMessage}
      
      답변 끝에 "(참고 문서 ID: ...)"를 붙여줘.
    `;

    const result = await chatModel.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return { statusCode: 200, body: JSON.stringify({ reply: text }) };

  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ error: "Server Error" }) };
  }
};