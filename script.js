// script.js
async function sendMessage() {
    const input = document.getElementById("user-input");
    const chatBox = document.getElementById("chat-box");
    const message = input.value.trim();

    if (!message) return;

    // 1. 내 메시지 화면에 표시
    addMessage(message, "user");
    input.value = "";

    // 2. 로딩 표시 (선택사항)
    const loadingDiv = addMessage("입력 중...", "bot");

    try {
        // 3. Netlify Function으로 메시지 전송
        const response = await fetch("/.netlify/functions/chat", {
            method: "POST",
            body: JSON.stringify({ message: message })
        });
        
        const data = await response.json();
        
        // 4. 봇 응답 표시
        chatBox.removeChild(loadingDiv); // 로딩 제거
        addMessage(data.reply, "bot");

    } catch (error) {
        chatBox.removeChild(loadingDiv);
        addMessage("오류가 발생했습니다.", "bot");
    }
}

function addMessage(text, sender) {
    const chatBox = document.getElementById("chat-box");
    const div = document.createElement("div");
    div.classList.add("message", sender);
    div.innerText = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    return div;
}

// 엔터키 전송 기능
document.getElementById("user-input").addEventListener("keypress", function(e) {
    if (e.key === "Enter") sendMessage();
});