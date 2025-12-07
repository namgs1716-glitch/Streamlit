const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function(event, context) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const body = JSON.parse(event.body);
    const userMessage = body.message;

    // 1. 설정
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
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
    const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
    
    const prompt = `
      너는 건설공사 안전관리(CSI) 전문가 챗봇이야.
      
      [미션]
      아래 [제공된 문서 꾸러미]에는 20개의 정보가 섞여 있어.
      이 중에서 **사용자의 질문과 가장 관련 있는 내용**을 스스로 찾아서 답변해.
      만약 질문과 정확히 일치하는 정보가 있다면 그 내용을 최우선으로 인용해.
      
      [사용자 질문]
      ${userMessage}

      [제공된 문서 꾸러미]
      ${contextText}
      
      답변 끝에 "(참고 문서 번호: ...)"를 적어줘.
    `;

    const result = await chatModel.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return { statusCode: 200, body: JSON.stringify({ reply: text }) };

  } catch (error) {
    console.error("Server Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "처리 실패" }) };
  }
};