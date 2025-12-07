import streamlit as st
import google.generativeai as genai
import rag  # 방금 만든 rag.py를 불러옵니다

# --- 1. 페이지 설정 ---
st.set_page_config(page_title="CSI 안전관리 챗봇", page_icon="🏗️")
st.title("🏗️ 건설공사 안전관리 종합정보망(CSI)")
st.caption("AI 지능형 도우미 (RAG 기반)")

# --- 2. API 키 입력 ---
with st.sidebar:
    if "GOOGLE_API_KEY" in st.secrets:
        api_key = st.secrets["GOOGLE_API_KEY"]
    else:
        api_key = st.text_input("Google API Key", type="password")
    
    st.markdown("---")
    st.write("📋 **데이터 로드 상태**")
    
    # API 키가 있을 때만 데이터 로드 시도
    vectorstore = None
    if api_key:
        try:
            with st.spinner("지식 데이터를 분석 중입니다..."):
                vectorstore = rag.get_vectorstore(api_key)
            st.success("✅ 지식 데이터 장착 완료!")
        except Exception as e:
            st.error(f"데이터 로드 실패: {e}")

# --- 3. 대화 UI ---
if "messages" not in st.session_state:
    st.session_state.messages = [{"role": "assistant", "content": "안녕하십니까. 건설공사 안전관리 종합정보망에 대해 무엇이든 물어보십시오."}]

for msg in st.session_state.messages:
    st.chat_message(msg["role"]).write(msg["content"])

if prompt := st.chat_input("질문을 입력하세요..."):
    if not api_key:
        st.error("API 키를 먼저 입력해주세요.")
        st.stop()

    # 사용자 질문 표시
    st.chat_message("user").write(prompt)
    st.session_state.messages.append({"role": "user", "content": prompt})

    # AI 응답 생성
    with st.chat_message("assistant"):
        with st.spinner("관련 규정을 찾아보고 있습니다..."):
            try:
                # 1) RAG 모듈을 통해 엑셀에서 관련 내용 검색
                context_data = rag.query_rag(vectorstore, prompt)
                
                # 2) Gemini에게 검색 결과 + 질문을 같이 줌
                genai.configure(api_key=api_key)
                model = genai.GenerativeModel('gemini-1.5-flash')
                
                full_prompt = f"""
                당신은 건설안전 전문가입니다. 아래 [검색된 정보]를 바탕으로 사용자의 질문에 답변하십시오.
                정보가 부족하면 솔직하게 모른다고 답하고, 지어내지 마십시오.
                답변은 '하십시오'체를 사용하고 전문적으로 작성하십시오.

                [검색된 정보]
                {context_data}

                [사용자 질문]
                {prompt}
                """
                
                response = model.generate_content(full_prompt)
                
                # 3) 결과 출력
                st.write(response.text)
                st.session_state.messages.append({"role": "assistant", "content": response.text})
                
                # (옵션) 디버깅용: 어떤 문서를 참고했는지 접는 메뉴로 보여줌
                with st.expander("참고한 문서 원문 보기"):
                    st.text(context_data)

            except Exception as e:
                st.error(f"오류가 발생했습니다: {e}")