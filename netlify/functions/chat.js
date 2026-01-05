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
      너는 '건설공사 안전관리 종합정보망(CSI)'의 공식 AI 규정 가이드야.
      너의 임무는 오직 아래 **[제공된 문서 꾸러미]**에 있는 사실에만 근거하여 답변하는 것이다.

      [엄격한 답변 규칙 - 반드시 지킬 것]
      1. **절대 지식 날조 금지:** [제공된 문서 꾸러미]에 없는 내용은 절대 답변하지 마. 네가 원래 알고 있던 법령 지식이나 외부 정보는 모두 무시해.
      2. **없는 내용 처리:** 사용자의 질문에 대한 답이 문서 꾸러미에 명확히 없다면, 말을 지어내지 말고 정중하게 "죄송합니다. 제공된 데이터베이스에는 해당 질문에 대한 구체적인 정보(규정)가 없습니다."라고만 답변해.
      3. **법령/규정 인용:** 법령 조항이나 숫자는 반드시 문서에 적힌 그대로만 인용해. (유사한 다른 법령을 추측해서 말하지 말 것)
      4. **출처 표기:** 답변 내용이 문서의 어느 부분에서 왔는지 끝에 반드시 명시해.

      [제공된 문서 꾸러미]
      ${contextText}
      
      [사용자 질문]
      ${userMessage}
      
      [답변 형식]
      - 답변 내용은 비전문가도 이해하기 쉽게 '하십시오'체로 작성.
      - 답변 끝에 줄을 바꾸고 "(근거 자료: 문서 번호 ...)" 형식으로 출처 기재.
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