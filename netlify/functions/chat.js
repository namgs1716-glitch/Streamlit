const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function(event, context) {
  // 1. 통신 방식 확인
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const body = JSON.parse(event.body);
    const userMessage = body.message;

    // 2. 환경변수 로드
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GEMINI_KEY);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // 3. 임베딩 생성 (사용자 질문을 벡터로 변환)
    const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const embeddingResult = await embeddingModel.embedContent(userMessage);
    const embedding = embeddingResult.embedding.values;

    // 4. Supabase 검색 (새로 만든 함수 match_safety_docs 사용)
    // 🔥 중요: match_threshold를 0.4~0.5로 높여서 '진짜 비슷한 질문'만 찾습니다.
    const { data: documents, error } = await supabase.rpc("match_safety_docs", {
      query_embedding: embedding,
      match_threshold: 0.40, 
      match_count: 5 
    });

    if (error) console.error("Supabase 검색 에러:", error);

    // 5. 문맥(Context) 조립
    let contextText = "";
    if (documents && documents.length > 0) {
        console.log(`✅ 검색 적중! 유사도: ${documents[0].similarity.toFixed(4)} / 질문: ${documents[0].question}`);
        
        // 검색된 '질문'이 아니라, 짝꿍인 '상세내용(context)'을 AI에게 줍니다.
        contextText = documents.map((doc, idx) => 
            `[참고문서 ${idx+1}]\n- 관련질문: ${doc.question}\n- 출처: ${doc.source}\n- 내용: ${doc.context}`
        ).join("\n\n----------------\n\n");
    } else {
        console.log("⚠️ 검색 결과 없음 (유사도 낮음)");
        contextText = "관련된 구체적인 문서가 데이터베이스에 없습니다. 건설 안전 전문가로서 일반적인 안전 지식을 바탕으로 답변해주세요.";
    }

    // 6. Gemini 모델 설정
    const chatModel = genAI.getGenerativeModel({
        model: "gemini-2.5-flash", 
        systemInstruction: {
            parts: [{ text: `
                너는 '건설공사 안전관리 종합정보망(CSI)'의 AI 안전 전문가야.
                
                [행동 지침]
                1. 아래 [참고문서] 내용을 최우선으로 근거하여 답변해.
                2. 답변 끝에는 반드시 출처(예: KOSHA GUIDE...)를 언급해.
                3. 문서에 없는 내용은 "제공된 자료에는 없지만,"이라고 밝히고 일반적인 안전 상식을 설명해.
                4. 말투는 정중하고 명확한 '해요'체를 사용해.
            `}]
        }
    });

    const prompt = `
      [참고문서]
      ${contextText}
      
      [사용자 질문]
      ${userMessage}
    `;

    // 7. 답변 생성
    const result = await chatModel.generateContent(prompt);
    const response = await result.response;
    const botReply = response.text();

    // ---------------------------------------------------------
    // 🔥 [복구된 기능] 대화 로그 기록 (비동기로 조용히 저장)
    // ---------------------------------------------------------
    try {
        const isFailed = botReply.includes("죄송합니다") || botReply.includes("정보가 없습니다");
        
        // await를 빼서 답변 속도 저하 방지 (Fire and Forget)
        supabase.from("chat_logs").insert({
            user_message: userMessage,
            bot_reply: botReply,
            is_failed: isFailed,
            created_at: new Date().toISOString() // 시간 기록
        }).then(({ error }) => {
            if (error) console.error("로그 저장 에러:", error);
        });
        
    } catch (logError) {
        console.error("로그 저장 로직 실패:", logError);
    }
    // ---------------------------------------------------------

    return { statusCode: 200, body: JSON.stringify({ reply: botReply }) };

  } catch (error) {
    console.error("Server Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "서버 오류가 발생했습니다." }) };
  }
};