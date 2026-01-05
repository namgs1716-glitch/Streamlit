const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function(event, context) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const body = JSON.parse(event.body);
    const userMessage = body.message;

    // 1. 설정
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // 2. 질문 임베딩
    const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const embeddingResult = await embeddingModel.embedContent(userMessage);
    const embedding = embeddingResult.embedding.values;

    // 3. 수파베이스 검색 (20개만 가져옵니다)
    // 50개는 너무 많을 수 있고, 20개 정도면 충분히 정답이 포함됩니다.
    const { data: documents, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.1,  // 문턱값 아주 낮게
      match_count: 20        // 🔥 상위 20개를 가져옵니다.
    });

    if (error) console.error("Supabase Error:", error);

    // 4. 🔥 [핵심 변경] 복잡한 필터링 삭제! 가져온 20개를 전부 다 텍스트로 만듭니다.
    let contextText = "";
    if (documents && documents.length > 0) {
      // 디버깅을 위해 로그에 어떤 문서들을 가져왔는지 찍어봅니다.
      console.log("검색된 문서 목록:", documents.map(d => d.content.substring(0, 20)));
      
      contextText = documents.map((doc, idx) => 
        `[문서 ${idx+1}] (출처: ${doc.metadata.source})\n${doc.content}`
      ).join("\n\n----------------\n\n");
    } else {
      contextText = "데이터베이스 검색 결과 없음.";
    }

    // 5. Gemini에게 전송
    // (모델 이름은 잘 작동하던 것으로 유지하세요!)
// ... (위쪽 검색 로직은 그대로 유지) ...

    // 5. Gemini 설정 (유연성 부여)
    const chatModel = genAI.getGenerativeModel({
        model: "gemini-2.5-flash", 
        
        // [변경 1] 시스템 지시문을 조금 더 친절하고 유연하게 수정
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
        
        // [변경 2] 창의력(Temperature)을 0.0 -> 0.3 으로 올림
        // 0.3은 팩트를 유지하면서도 문맥을 이해하는 적절한 수치입니다.
        generationConfig: {
            temperature: 0.3, 
            maxOutputTokens: 1000,
        }
    });
    
    // 프롬프트는 그대로 심플하게 유지
    const prompt = `
      [제공된 문서]
      ${contextText}
      
      [사용자 질문]
      ${userMessage}
      
      [요청]
      위 문서를 참고하여 사용자의 질문에 답변해줘. 답변 끝에 관련된 근거 문서 번호가 있다면 (참고: 문서 #1) 처럼 남겨줘.
    `;

    const result = await chatModel.generateContent(prompt);
    
    // ... (아래쪽 응답 처리 코드 동일) ...
    const response = await result.response;
    const text = response.text();

    return { statusCode: 200, body: JSON.stringify({ reply: text }) };

  } catch (error) {
    console.error("Server Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "처리 실패" }) };
  }
};