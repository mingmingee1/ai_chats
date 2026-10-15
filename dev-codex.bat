@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
echo 단톡방 서버는 start.bat으로 먼저 켜 두세요.
node cli.mjs codex mcp add ai-chatroom -- node "%~dp0dev-bridge\mcp-server.mjs"
if errorlevel 1 goto failed
node cli.mjs codex -m gpt-6-astra -c model_reasoning_effort=xhigh "ai-chatroom 도구로 개발자 세션을 연결해. 최근 대화를 읽고 인사한 다음, @개발자 호출을 계속 기다려 줘."
if errorlevel 1 goto failed
exit /b 0
:nonode
echo Node.js를 찾을 수 없습니다. setup.bat을 먼저 실행하세요.
:failed
pause
exit /b 1
