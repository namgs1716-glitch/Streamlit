const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function(event, context) {
  // 1. 요청 방식 확인
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const body = JSON.parse(event.body);
    const userMessage = body.message;

    // 2. 설정 (환경변수 확인: GOOGLE_API_KEY 사용 권장)
    // 만약 Netlify 환경변수 이름을 GEMINI_KEY로 설정했다면 아래 process.env.GEMINI_KEY 유지
    // GOOGLE_API_KEY로 설정했다면 process.env.GOOGLE_API_KEY로 변경하세요.
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GEMINI_KEY);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // 3. 질문 임베딩 생성
    const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const embeddingResult = await embeddingModel.embedContent(userMessage);
    const embedding = embeddingResult.embedding.values;

    // 4. 수파베이스 검색 (가장 중요한 부분!)
    const { data: documents, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.01,  // 🔥 문턱값: 1%라도 비슷하면 가져오기
      match_count: 30         // 🔥 개수: 30개까지 넉넉하게 가져오기
    });

    if (error) {
        console.error("❌ 수파베이스 검색 에러:", error);
    }

    // 5. 검색 결과 정리 (변수 선언 에러 해결 및 로직 통합)
    let contextText = ""; // 🔥 [중요] 변수를 여기서 미리 만듭니다!

    if (documents && documents.length > 0) {
        // [디버깅 로그] 무엇을 찾았는지 서버 로그에 기록
        console.log(`✅ 검색된 문서 개수: ${documents.length}개`);
        console.log("🥇 1등 문서 내용:", documents[0].content.substring(0, 50) + "...");
        console.log("🥇 1등 유사도 점수:", documents[0].similarity);

        // 문서 내용을 하나의 긴 텍스트로 합치기
        contextText = documents.map((doc, idx) => 
            `[문서 ${idx+1}] (유사도: ${doc.similarity ? doc.similarity.toFixed(4) : 'N/A'})\n${doc.content}`
        ).join("\n\n----------------\n\n");
    } else {
        console.log("😱 검색 결과가 0개입니다! (데이터가 없거나 임베딩 문제)");
        contextText = "데이터베이스에서 관련 정보를 찾을 수 없습니다.";
    }

    // 6. Gemini 답변 생성 설정 (친절 모드 + 유연성 30%)
    // (gemini-2.5-flash라는 모델은 없으므로 안정적인 1.5-flash 사용)
    const chatModel = genAI.getGenerativeModel({
        model: "gemini-2.5-flash", 
        
        // 시스템 지시문: 친절하고 융통성 있게
        systemInstruction: {
            parts: [{ text: `
                너는 '건설공사 안전관리 종합정보망(CSI)'의 친절한 AI 어시스턴트야.
                너의 목표는 [제공된 문서]의 내용을 바탕으로 사용자의 질문에 최대한 도움이 되는 답변을 하는 거야.
                
                [답변 가이드]
                1. 기본적으로 [제공된 문서]에 있는 내용을 최우선으로 참고해서 답변해.
                2. 문서에 정확히 똑같은 문장이 없더라도, 문맥상 유추할 수 있는 내용이라면 종합해서 설명해줘. (융통성 발휘)
                3. 만약 문서에 관련 내용이 **전혀** 없다면, 솔직하게 "문서에서 정확한 정보를 찾을 수 없습니다."라고 말하고, 네가 알고 있는 일반적인 건설 안전 지식을 덧붙여서 도움을 줘도 좋아. (단, 이때는 "일반적인 안전 수칙에 따르면..."이라고 출처를 구분해줘.)
                4. 답변은 딱딱한 로봇 말투보다, 전문적이지만 친절한 '해요'체를 사용해.
            `}]
        },
        
        // 창의력 설정: 0.3 (팩트 기반이지만 약간의 융통성 허용)
        generationConfig: {
            temperature: 0.3, 
            maxOutputTokens: 1000,
        }
    });
    
    // 7. 최종 프롬프트 조합 및 전송
    const prompt = `
      [제공된 문서]
      ${contextText}
      
      [사용자 질문]
      ${userMessage}
      
      [요청]
      위 문서를 참고하여 사용자의 질문에 답변해줘. 답변 끝에 관련된 근거 문서 번호가 있다면 (참고: 문서 #1) 처럼 남겨줘.
    `;

    const result = await chatModel.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return { statusCode: 200, body: JSON.stringify({ reply: text }) };

  } catch (error) {
    console.error("Server Error:", error);
    // 에러 내용을 구체적으로 반환하여 디버깅 도움
    return { statusCode: 500, body: JSON.stringify({ error: "처리 실패: " + error.message }) };
  }
};