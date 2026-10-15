# AI 단톡방 안드로이드 앱

안드로이드 8 이상에 설치하는 APK입니다. PC의 최신 웹 화면을 앱 안에서 불러옵니다.
AI 단톡방·업무방·개발자 탭, 프사와 사용자 설정은 기존 PC 서버의 것을 사용합니다.
대화와 기억을 APK에 복사하지 않으며 AI는 기존 PC의 CLI로 실행됩니다.

[APK 다운로드 · 1.0.1](https://raw.githubusercontent.com/mingmingee1/ai_chats/main/mobile/releases/ai-chats-1.0.1.apk) · [파일 체크섬](releases/SHA256SUMS)

1.0.1에서는 앱 자체의 상단 바를 없애고, 안드로이드 상태 표시줄과 하단 내비게이션 영역을 현재 채팅 배경색에 맞춥니다. 채팅방의 밝은 테마·어두운 테마를 바꾸면 함께 반영됩니다. 기존 1.0.0 사용자는 앱을 삭제하지 않고 새 APK를 열어 **업데이트**하면 됩니다. 연결 주소와 로그인은 유지되며, 이 화면 변경을 위해 PC를 다시 설정할 필요는 없습니다.

## 처음 한 번 연결

1. 휴대폰에 `ai-chats-1.0.1.apk`를 설치합니다. 다운로드한 앱의 설치 허용이 필요할 수 있습니다.
2. PC 개발자는 기존 변경을 보존하면서 최신 GitHub 코드를 반영합니다. `data/`, `workspace/`, `config.json`을 새 폴더의 것으로 덮어쓰지 않습니다.
3. PC에서 `setup-mobile.bat`을 실행합니다. Tailscale이 HTTPS/Serve 활성화 링크를 출력하면 해당 링크를 열어 활성화합니다. 다른 서비스가 443 포트를 쓰면 도우미가 덮어쓰지 않고 중단합니다.
4. 기존 서버 창에서 Ctrl+C로 종료하고 같은 폴더의 `start.bat`을 다시 실행합니다.
5. 도우미에 표시된 `https://PC이름.네트워크.ts.net` 주소를 휴대폰 앱에 입력합니다. 또는 `data/mobile-connection.json`을 휴대폰으로 옮겨 앱의 **연결 파일로 설정하기**를 누릅니다. 연결 파일에는 주소만 들어 있습니다.
6. 기존 `data/external-password.txt`의 채팅방 비밀번호로 로그인합니다. 별도로 비밀번호를 변경했다면 변경한 비밀번호를 사용합니다.

`https://100.x.x.x:18321` 주소는 자체 인증서 때문에 앱에서 사용하지 않습니다. 새 주소는 Tailscale Serve가 정식 HTTPS 인증서를 발급받아 제공합니다. PC와 휴대폰 모두 Tailscale에 연결돼 있어야 합니다. 공유기 포트 개방이나 Funnel(인터넷 공개)은 필요하지 않습니다.

Tailscale HTTPS를 처음 활성화하면 PC의 인증서 도메인 이름이 공개 인증서 투명성 로그에 기록됩니다. 채팅 내용과 비밀번호는 이 로그에 기록되지 않습니다.

## 평소 업데이트

PC에서 파일 수정 → 필요한 경우 서버 재시작 → 휴대폰 홈 화면의 **AI 단톡방 아이콘 길게 누르기 → 새로고침**.

주소 변경·로그아웃·앱 정보는 **앱 아이콘 길게 누르기 → 앱 설정**에서 엽니다. 앱 안의 채팅방 메뉴와 탭은 기존 PC 화면 그대로 사용할 수 있습니다.

GitHub 업로드와 APK 재설치는 일반적인 화면·프롬프트·서버 기능 변경에 필요하지 않습니다. 앱 권한이나 안드로이드 전용 기능을 수정할 때만 새 APK가 필요합니다.

앱은 로그인 쿠키를 Android WebView의 앱 전용 저장소에 보관합니다. PC에 저장된 세션이 만료되거나 비밀번호를 바꾸면 다시 로그인해야 합니다. 앱을 닫아도 PC 서버는 계속 실행되며, PC가 꺼지거나 Tailscale 연결이 끊기면 앱은 연결 안내 화면을 표시합니다. 현재 버전은 **백그라운드 새 메시지 알림과 앱 내 첨부파일 다운로드를 제공하지 않습니다**. 사진 선택·업로드는 안드로이드 파일 선택기를 사용하며 별도의 전체 저장소 권한을 요청하지 않습니다.

## 연결 구조

```text
Android APK (WebView)
    ↓ Tailscale 안의 정식 HTTPS :443
PC Tailscale Serve
    ↓ 같은 PC의 127.0.0.1:18322
기존 채팅방의 비밀번호 로그인 → 최신 웹 화면 / API / 실시간 이벤트
```

모바일 포트는 항상 loopback에만 바인딩됩니다. 공개 Host와 일치하는 요청만 처리하고 외부 접속용 비밀번호 확인과 Secure 쿠키를 유지합니다. 개발자 채팅 탭(`/api/conversations/developer`)은 로그인 후 이용 가능하고, 실제 MCP 개발자 브릿지(`/api/dev/*`)는 모바일 경로에서도 차단됩니다. 기존 로컬 포트 8321과 외부 접속 포트 18321은 그대로 유지됩니다.

## 빌드

`android/`를 Android Studio에서 열어 빌드하거나, JDK 17+·Python 3·Android SDK `platforms;android-35`, `build-tools;35.0.0`으로 다음 명령을 사용합니다. 앱에는 외부 라이브러리 의존성이 없습니다.

```sh
python3 mobile/android/build-apk.py --sdk /path/to/android-sdk \
  --keystore /private/ai-chats.jks --password-file /private/password.txt \
  --out /path/to/ai-chats-1.0.1.apk
```

키 별칭은 `aichats`입니다. 업데이트 APK는 최초 설치와 **동일한 서명 키**로 서명해야 합니다. 서명 키·비밀번호 파일은 GitHub에 올리지 말고 별도로 보관하세요. Gradle/Android Studio로 만든 debug APK는 제공된 APK와 서명이 달라 그대로 덮어 설치할 수 없습니다.

빌드 스크립트는 APK v2/v3 서명과 zipalign 검증을 수행합니다. Java의 `ConnectionAddressTest`는 주소·외부 이동 검사를, `node --test tests/mobile.test.mjs`는 모바일 로그인·쿠키·개발자 API 차단·실시간 메시지·PC와 같은 기록 사용을 검사합니다.
