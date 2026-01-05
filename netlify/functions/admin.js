const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function(event, context) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const body = JSON.parse(event.body);
    const { action, password, q, a, id } = body; // action: 'get_logs' 또는 'teach'

    // 1. 보안 검사 (비밀번호 확인)
    if (password !== process.env.ADMIN_PASSWORD) {
        return { statusCode: 401, body: JSON.stringify({ error: "비밀번호가 틀렸습니다." }) };
    }

    // 2. 설정
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GEMINI_KEY);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // --- 기능 A: 답변 실패한 로그 가져오기 ---
    if (action === 'get_logs') {
        const { data, error } = await supabase
            .from('chat_logs')
            .select('*')
            .eq('is_failed', true)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ logs: data }) };
    }

    // --- 기능 B: AI 가르치기 (임베딩 + 저장) ---
    if (action === 'teach') {
        if (!q || !a) return { statusCode: 400, body: JSON.stringify({ error: "질문과 답변이 필요합니다." }) };

        // 1) 텍스트 합치기
        const contentText = `Q: ${q}\nA: ${a}`;

        // 2) 임베딩 생성
        const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
        const result = await model.embedContent(contentText);
        const embedding = result.embedding.values;

        // 3) DB(learned_knowledge)에 저장
        const { error: insertError } = await supabase.from('learned_knowledge').insert({
            content: contentText,
            metadata: { source: "관리자_웹_학습", category: "feedback" },
            embedding: embedding
        });

        if (insertError) throw insertError;

        // 4) (선택사항) 해당 로그는 이제 해결되었으니 is_failed를 false로 변경
        if (id) {
            await supabase.from('chat_logs').update({ is_failed: false }).eq('id', id);
        }

        return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "알 수 없는 요청입니다." }) };

  } catch (error) {
    console.error("Admin Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};