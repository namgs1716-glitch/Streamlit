const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function(event, context) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const body = JSON.parse(event.body);
    const userMessage = body.message;

    // 1. API 키 준비 (Netlify 환경변수에 SUPABASE_URL, SUPABASE_KEY 추가 필요!)
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // 2. 사용자 질문을 숫자로 변환 (임베딩)
    const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const embeddingResult = await embeddingModel.embedContent(userMessage);
    const embedding = embeddingResult.embedding.values;

    // 3. 수파베이스에서 비슷한 내용 검색 (RPC 함수 호출)
    const { data: documents, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.5, // 유사도 50% 이상인 것만
      match_count: 3        // 3개만 가져오기
    });

    if (error) console.error("Supabase 검색 에러:", error);

    // 4. 검색된 지식을 텍스트로 정리
    let contextText = "";
    if (documents && documents.length > 0) {
      contextText = documents.map(doc => doc.content).join("\n\n");
    } else {
      contextText = "관련된 정보가 데이터베이스에 없습니다.";
    }

    // 5. 제미나이에게 질문 + 지식 전달
    // (여기서 아까 성공했던 'gemini-2.0-flash-exp' 등을 쓰세요)
    const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 
    
    const prompt = `
      너는 건설공사 안전관리 챗봇이야. 
      아래 [참고 정보]를 바탕으로 사용자의 질문에 답해줘.
      정보가 없으면 모른다고 솔직하게 말해.
      
      [참고 정보]
      ${contextText}
      
      [사용자 질문]
      ${userMessage}
    `;

    const result = await chatModel.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return { statusCode: 200, body: JSON.stringify({ reply: text }) };

  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ error: "처리 실패" }) };
  }
};