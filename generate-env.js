const fs = require('fs');

const content = `
export const CONFIG = {
    GEMINI_KEY: "${process.env.GEMINI_KEY || ''}",
    SUPABASE_URL: "${process.env.SUPABASE_URL || ''}",
    SUPABASE_KEY: "${process.env.SUPABASE_KEY || ''}"
};
`;

fs.writeFileSync('./apikey.js', content);
console.log("✅ apikey.js 파일 생성 완료!");