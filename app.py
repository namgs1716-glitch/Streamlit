import streamlit as st
import google.generativeai as genai

# --- 1. 페이지 설정 (탭 이름 및 아이콘) ---
st.set_page_config(
    page_title="CSI 안전관리 챗봇",
    page_icon="🏗️",
    layout="centered"
)

# --- 2. 헤더 및 소개 (요청하신 예시 A 적용) ---
st.title("🏗️ 건설공사 안전관리 종합정보망(CSI)")
st.subheader("AI 지능형 도우미 서비스")

st.markdown("""
---
반갑습니다. **건설공사 안전관리 종합정보망(CSI) AI 도우미**입니다.  
건설 현장 안전관리 업무와 관련된 법령, 시스템 사용법, 제도 등에 대해 문의해 주시면 신속하게 안내해 드리겠습니다.

* **주요 안내 분야:** 안전관리계획서, 안전점검, 재해 예방 기술 지도 등
---
""")

# --- 3. 사이드바 (API 키 설정) ---
with st.sidebar:
    st.header("⚙️ 시스템 설정")
    # 배포 시 Secrets를 사용하고, 로컬에서는 직접 입력
    if "GOOGLE_API_KEY" in st.secrets:
        api_key = st.secrets["GOOGLE_API_KEY"]
    else:
        api_key = st.text_input("관리자 인증 키 (API Key)", type="password")
    
    st.info("💡 본 서비스는 현장 관리자 및 공공기관 실무자를 지원하기 위해 제작되었습니다.")

# --- 4. 대화 기록 관리 (Session State) ---
if "messages" not in st.session_state:
    st.session_state.messages = []

# 기존 대화 내용 화면에 표시
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.write(message["content"])

# --- 5. 사용자 입력 처리 ---
if prompt := st.chat_input("문의하실 내용을 입력해 주세요."):
    if not api_key:
        st.error("⚠️ 시스템 사용을 위한 인증 키가 필요합니다.")
        st.stop()

    # 사용자 메시지 표시
    st.chat_message("user").write(prompt)
    st.session_state.messages.append({"role": "user", "content": prompt})

    # --- 6. AI 응답 생성 (페르소나 설정) ---
    try:
        genai.configure(api_key=api_key)
        
        # 시스템 프롬프트: AI의 성격과 말투를 지정합니다.
        system_instruction = """
        너는 '건설공사 안전관리 종합정보망(CSI)'의 공식 AI 도우미야.
        주 사용자는 건설현장 관리자와 공공기관 담당자이므로, 말투는 항상 '하십시오'체를 사용하여 정중하고 전문적으로 대답해야 해.
        불확실한 정보는 추측하지 말고, 정확한 정보만 전달하도록 노력해.
        """
        
        model = genai.GenerativeModel(
            'gemini-1.5-flash',
            system_instruction=system_instruction
        )
        
        with st.spinner("정보를 조회하고 있습니다..."):
            # 대화 맥락 유지 (RAG 적용 전 임시 로직)
            response = model.generate_content(prompt)
            bot_response = response.text

        # AI 메시지 표시
        st.chat_message("assistant").write(bot_response)
        st.session_state.messages.append({"role": "assistant", "content": bot_response})

    except Exception as e:
        st.error(f"시스템 오류가 발생했습니다: {e}")