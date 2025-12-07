import pandas as pd
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_community.vectorstores import Chroma
from langchain.schema import Document
import os
import streamlit as st

# 1. 엑셀 파일 설정 (파일 이름이 다르면 여기서 꼭 수정해주세요!)
FILE_PATH = "./data/safety_faq.xlsx" 

def load_excel_data():
    """엑셀 데이터를 읽어서 검색 가능한 문서 객체로 변환합니다."""
    if not os.path.exists(FILE_PATH):
        st.error(f"데이터 파일이 없습니다. {FILE_PATH} 위치에 엑셀 파일을 넣어주세요.")
        return []
    
    # 엑셀 읽기 (엔진 지정)
    df = pd.read_excel(FILE_PATH, engine='openpyxl')
    
    # 필수 컬럼(Q, A)에 내용이 없는 행은 제거
    df = df.dropna(subset=['Q', 'A'])
    
    docs = []
    for _, row in df.iterrows():
        # 검색 AI가 읽을 내용 (질문 + 답변 + 태그)
        # 태그가 있으면 검색이 더 잘 됩니다.
        tags = row['tags'] if 'tags' in row and pd.notna(row['tags']) else ""
        content = f"질문(Q): {row['Q']}\n답변(A): {row['A']}\n관련키워드: {tags}"
        
        # 출처나 작업키는 메타데이터로 따로 보관 (나중에 참고용)
        source = row['source'] if 'source' in row and pd.notna(row['source']) else "정보망"
        metadata = {"source": source, "question": row['Q']}
        
        docs.append(Document(page_content=content, metadata=metadata))
            
    return docs

@st.cache_resource
def get_vectorstore(api_key):
    """
    (중요) 벡터 저장소는 매번 만들면 느리고 돈이 듭니다. 
    @st.cache_resource를 써서 한 번만 만들고 계속 재사용합니다.
    """
    docs = load_excel_data()
    if not docs:
        return None

    # 임베딩 모델 (텍스트 -> 숫자 변환기)
    embeddings = GoogleGenerativeAIEmbeddings(
        model="models/text-embedding-004", 
        google_api_key=api_key
    )
    
    # ChromaDB에 데이터 저장 (임시 메모리 모드)
    vectorstore = Chroma.from_documents(
        documents=docs, 
        embedding=embeddings,
        collection_name="csi_safety_qa"
    )
    return vectorstore

def query_rag(vectorstore, query):
    """질문(query)과 가장 유사한 답변을 찾아옵니다."""
    if vectorstore is None:
        return "데이터가 로드되지 않았습니다."
        
    # 유사도 검색: 질문과 가장 비슷한 내용 3개를 뽑음
    results = vectorstore.similarity_search(query, k=3)
    
    # 검색된 내용을 하나로 합쳐서 반환
    context = ""
    for i, doc in enumerate(results):
        context += f"[참고문서 {i+1} - 출처: {doc.metadata['source']}]\n{doc.page_content}\n\n"
        
    return context