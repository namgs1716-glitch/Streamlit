import pandas as pd
import google.generativeai as genai
from supabase import create_client, Client
import time

# --- 설정값 (여기를 채우세요!) ---
SUPABASE_URL = "https://yrerfkfyilucucgwoyyq.supabase.co" # 수파베이스 설정 > API 에 있음
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyZXJma2Z5aWx1Y3VjZ3dveXlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzM2ODM3MywiZXhwIjoyMDc4OTQ0MzczfQ.theI9Ia3LPF7i7fk4ScwIH14MZMD11_ZX4mNFD4VpRI" # 수파베이스 설정 > API > service_role key (secret 아님!)
GOOGLE_API_KEY = "AIzaSyDwUfJy2pWVG-u0ClBb4baJyu5lNTZsFQ4" # 구글 키

# --- 연결 설정 ---
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
genai.configure(api_key=GOOGLE_API_KEY)

# --- 엑셀 파일 읽기 ---
df = pd.read_excel("C:\dev\Streamlit\safety_faq.xlsx", engine='openpyxl') # 파일 경로 확인!
df = df.dropna(subset=['Q', 'A'])

print(f"총 {len(df)}개의 데이터를 업로드합니다...")

for index, row in df.iterrows():
    # 1. 텍스트 합치기
    text_content = f"Q: {row['Q']}\nA: {row['A']}"
    
    # 2. 제미나이를 이용해 텍스트를 숫자로 변환 (임베딩)
    # 중요: 'text-embedding-004' 모델 사용
    result = genai.embed_content(
        model="models/text-embedding-004",
        content=text_content,
    )
    embedding_vector = result['embedding']
    
    # 3. 수파베이스에 저장
    data = {
        "content": text_content,
        "metadata": {"source": "safety_faq"},
        "embedding": embedding_vector
    }
    supabase.table("documents").insert(data).execute()
    
    print(f"[{index+1}] 업로드 완료: {row['Q'][:20]}...")
    time.sleep(0.5) # 너무 빠르면 에러날 수 있어서 잠깐 쉼

print("🎉 모든 데이터 업로드 완료!")