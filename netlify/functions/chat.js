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

    // =========================================================================
    // 🚀 [핵심 기능] 1단계: 사용자 질문을 '표준 검색 키워드'로 변환 (Subject + Action)
    // =========================================================================
    const keywordModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const keywordPrompt = `
      역할: 너는 건설 안전 데이터베이스 검색 최적화 AI야.
      목표: 사용자의 질문을 분석해서, 데이터베이스 검색에 가장 적합한 '핵심 키워드 조합'으로 변환해.
      
      [변환 규칙]
      1. 불필요한 조사, 어미, 감탄사, 감정 표현, 상황 설명은 모두 제거해.
      2. 반드시 [주제(명사)] + [목적/행위(명사형)] 형태로 조합해. (쪼개지 말고 합쳐서)
      3. 건설 현장 은어나 사투리는 표준 용어로 변경해. (예: '공구리' -> '콘크리트', '아시바' -> '비계')
      4. 오직 변환된 검색어 단어만 출력해. 부가 설명 절대 금지.

      [예시]
      - "현장대리인이 갑자기 그만뒀는데 사람 어떻게 바꿔요?" -> "현장대리인 변경 절차"
      - "비 오는데 공구리 쳐도 됨?" -> "우천 시 콘크리트 타설 기준"
      - "안전모 안 쓰면 벌금 얼마야?" -> "보호구 미착용 과태료"
      - "비계 기둥 간격이 어떻게 됩니까?" -> "비계 수직재 설치 간격"
      - "안녕?" -> "인사"

      [사용자 질문]
      "${userMessage}"
    `;

    const keywordResult = await keywordModel.generateContent(keywordPrompt);
    let refinedQuery = keywordResult.response.text().trim();
    
    // 줄바꿈이나 특수문자 제거 (안전장치)
    refinedQuery = refinedQuery.replace(/\n/g, "").replace(/\*\*/g, "");

    console.log(`🔄 [검색어 변환] 사용자: "${userMessage}" -> AI검색어: "${refinedQuery}"`);

    // =========================================================================
    // 🚀 2단계: 변환된 키워드로 임베딩 및 검색 수행
    // =========================================================================
    const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
    
    // 🔥 중요: userMessage가 아니라 'refinedQuery'로 임베딩을 만듭니다.
    const embeddingResult = await embeddingModel.embedContent(refinedQuery);
    const embedding = embeddingResult.embedding.values;

    // Supabase 검색 (threshold는 0.25 ~ 0.3 추천)
    const { data: documents, error } = await supabase.rpc("match_safety_docs", {
      query_embedding: embedding,
      match_threshold: 0.25, 
      match_count: 5 
    });

    if (error) console.error("Supabase 검색 에러:", error);

    // =========================================================================
    // 🚀 3단계: 문맥 조립 및 최종 답변 생성
    // =========================================================================
    let contextText = "";
    if (documents && documents.length > 0) {
        console.log(`✅ 검색 적중! 유사도: ${documents[0].similarity.toFixed(4)} / 문서질문: ${documents[0].question}`);
        
        contextText = documents.map((doc, idx) => 
            `[참고문서 ${idx+1}]\n- 주제: ${doc.question}\n- 출처: ${doc.source}\n- 내용: ${doc.context}`
        ).join("\n\n----------------\n\n");
    } else {
        console.log("⚠️ 검색 결과 없음");
        contextText = "관련된 구체적인 문서가 데이터베이스에 없습니다. 일반적인 건설 안전 지식을 바탕으로 답변해주세요.";
    }

    // Gemini 모델 설정 (답변 생성용)
    const chatModel = genAI.getGenerativeModel({
        model: "gemini-2.5-flash", 
        systemInstruction: {
            parts: [{ text: `
                너는 '건설공사 안전관리 종합정보망(CSI)'의 AI 안전 전문가야.
                
                [행동 지침]
                1. 아래 [참고문서] 내용을 최우선으로 근거하여 답변해.
                2. 답변 끝에는 반드시 출처(예: KOSHA GUIDE...)를 명시해.
                3. 문서에 없는 내용은 "제공된 자료에는 없지만,"이라고 밝히고 일반적인 안전 상식을 설명해.
                4. 말투는 전문적이면서도 친절한 '해요'체를 사용해.
                5. 사용자가 인사를 하면 가볍게 받아주고 안전 관련 질문을 유도해.
            `}]
        }
    });

    const prompt = `
      [검색된 참고문서]
      ${contextText}
      
      [사용자 원본 질문]
      ${userMessage}
    `;

    const result = await chatModel.generateContent(prompt);
    const response = await result.response;
    const botReply = response.text();

    // =========================================================================
    // 💾 로그 저장 (비동기 처리)
    // =========================================================================
    try {
        const isFailed = botReply.includes("죄송합니다") || botReply.includes("정보가 없습니다");
        
        supabase.from("chat_logs").insert({
            user_message: userMessage,
            bot_reply: botReply,
            is_failed: isFailed,
            created_at: new Date().toISOString()
        }).then(({ error }) => {
            if (error) console.error("로그 저장 에러:", error);
        });
        
    } catch (logError) {
        console.error("로그 저장 로직 실패:", logError);
    }

    return { statusCode: 200, body: JSON.stringify({ reply: botReply }) };

  } catch (error) {
    console.error("Server Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "서버 오류가 발생했습니다." }) };
  }
};