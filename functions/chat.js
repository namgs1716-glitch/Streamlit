// netlify/functions/chat.js
const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async function(event, context) {
  // 1. 보안 점검: POST 요청만 허용
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // 2. 사용자 메시지 받기
    const body = JSON.parse(event.body);
    const userMessage = body.message;

    // 3. Gemini API 설정 (환경변수에서 키 가져옴)
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // 4. 시스템 프롬프트 (여기에 엑셀 내용을 요약해서 텍스트로 넣어야 함)
    const systemPrompt = `
      너는 건설공사 안전관리 종합정보망(CSI) AI 도우미야.
      공무원이나 현장 관리자에게 정중한 '하십시오'체를 써.
      
      [주요 지식]
      - 안전관리계획서는 착공 전 제출 필수.
      - 1/2종 시설물은 안전관리계획서 수립 대상.
    `;
    
    // 5. 질문 던지기
    const prompt = `${systemPrompt}\n\n사용자: ${userMessage}\nAI:`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // 6. 결과 반환
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: text }),
    };

  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Gemini 연결 실패" }),
    };
  }
};