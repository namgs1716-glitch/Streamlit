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

// ... (위쪽 코드는 동일)

    // 4. 수파베이스 검색 (필터 없이 무조건 가져옴)
    const { data: documents, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.0, // 0.0으로 설정해도 위 SQL에서 필터를 뺐으니 상관없음
      match_count: 10
    });

    if (error) console.error("Supabase 검색 에러:", error);

    // 5. 찾아온 지식 정리 + 🔥 [디버깅용] 점수 확인
    let contextText = "";
    let debugInfo = ""; // 점수 기록용 변수

    if (documents && documents.length > 0) {
      contextText = documents.map(doc => doc.content).join("\n\n");
      
      // 화면에 뿌려줄 점수 정보 만들기
      debugInfo = documents.map((doc, index) => 
        `\n[문서 ${index + 1}] 유사도: ${(doc.similarity * 100).toFixed(2)}%`
      ).join("");
      
    } else {
      contextText = "데이터베이스에서 아무것도 찾지 못했습니다.";
    }

    // 6. 제미나이 답변 생성
    const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
    
    const prompt = `
      너는 건설공사 안전관리(CSI) 전문가 챗봇이야.
      
      [지시사항]
      1. 아래 [제공된 문서들] 중에서 사용자의 질문과 가장 관련 있는 내용을 찾아서 답변해.
      2. 질문과 관련 없는 문서는 과감히 무시해.
      3. 답변은 비전문가도 이해하기 쉽게 설명하고, 출처가 있다면 (출처: ...)라고 명시해.
      4. 만약 문서들 속에 정답이 전혀 없다면 "죄송합니다. 데이터베이스에 관련 정보가 없습니다."라고 말해.

      [제공된 문서들]
      ${contextText}
      
      [사용자 질문]
      ${userMessage}
    `;

    const result = await chatModel.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // 🔥 답변 뒤에 우리가 만든 [유사도 점수]를 붙여서 보냄!
    const finalReply = text + "\n\n--- [개발자 디버깅 정보] ---" + debugInfo;

    return { statusCode: 200, body: JSON.stringify({ reply: finalReply }) };

// ... (아래쪽 에러 처리 동일)
  } catch (error) {
    console.error("서버 에러:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "처리 중 오류가 발생했습니다." }) };
  }
};