 1. iOS 문제 — useWebKit 누락이 왜 치명적인가                                                            
                                                                                                            WKWebView가 쓰는 쿠키 스토어는 WKWebsiteDataStore.default().httpCookieStore. 근데 useWebKit=false 분기는   HTTPCookieStorage.shared(완전 다른 스토어)만 지움.                                                                                                                                                               
  그래서 실제 일어나는 일:                                                                                
  - 🍪 쿠키삭제 버튼 누름 → HTTPCookieStorage.shared 비움 (여기엔 애초에 중요한 게 거의 없음)               - WKWebView 내부 쿠키 스토어의 accessToken/refreshToken은 그대로 생존                                     - webViewRef.reload() → WKWebView가 자기 스토어에서 쿠키 꺼내 Request header에 붙임                       - 서버는 유효 refreshToken 받음 → 인증 통과 → 로그인 유지                                               

  한 줄로: 버튼이 엉뚱한 서랍을 비우고 있음. "WebView 쿠키"라고 말하지만 WebView가 안 쓰는 쿠키 보관소를  
  지움.

  2. 안드 유령 로그인 — 예전 "로그인 안 되는 문제"와의 관계

  유령 로그인 시나리오

  1. 로그인 성공 → AppState background → backup() → AsyncStorage에 쿠키 스냅샷 저장(토큰 포함)
  2. 웹에서 로그아웃 (서버가 Set-Cookie로 토큰 쿠키 만료) → WebView 쿠키 잔여 제거
  3. 근데 웹이 AUTH_STATE_CHANGED: logout 이벤트를 송신하지 않음 → cookieBackupService.clear() 호출되지   
  않음 → AsyncStorage 스냅샷에 옛 토큰 그대로
  4. 앱 종료 후 재실행 → cold start의 restore() → 옛 쿠키를 WebView에 재주입 → 로그아웃했는데 로그인      
  상태로 부활

  "가끔 로그인 자체가 안 되는 문제"와의 관련성 — 매우 높음

  같은 restore 경로에서 반대 증상으로 터짐. 원인 분기:

  - A. Torn state race (A-2/A-6): OAuth callback이 Set-Cookie 쏘는 중에 AppState background → backup()이  
  accessToken은 들어왔는데 refreshToken은 아직 못 들어온 중간 상태를 스냅샷. 재시작 시 restore가 토큰 페어
   깨진 상태를 재주입 → 서버 검증 실패 → 로그인 실패.
  - B. httpOnly/expires 속성 소실 (A-5): cookieBackupService.ts:47-55의 restore 로직이 secure:
  cookie.secure ?? true, httpOnly: cookie.httpOnly ?? false, expires는 optional. Android
  CookieManager.get()이 httpOnly/expires를 안 돌려주는 경우가 있음 → restore 후 session cookie로 박힘 → 앱
   프로세스 종료 시 사라짐 → 다음 실행 시 로그인 풀려있음.
  - C. 토큰 rotation + stale 스냅샷: 서버가 refresh token rotation(1회용) 정책이면, restore가 돌려놓은 옛 
  refreshToken은 이미 서버에서 무효화됨 → 첫 refresh 콜 401 → forceLogout → 로그아웃 토스트.
  - D. Domain 기본값 문제: restore 시 domain: cookie.domain || .${BACKUP_DOMAIN}``. 서버가 recipio.kr(dot 
  없이)로 발급한 경우와 mismatch 가능 → WebView가 해당 쿠키를 요청에 붙이지 않음 → 로그인 안 된 것처럼    
  보임.

  A, C가 가장 개연성 높음.

  3. 공통: 로그인이 "갑자기" 풀리는 상황

  백업 시스템 무관 (서버/만료 기인)

  - refresh token 서버 TTL 만료
  - 서버 측 세션 강제 종료 (비번 변경, 다른 기기 로그인 등)
  - fetch interceptor의 refresh 실패 → forceLogout 이벤트(useAuthManager.ts:61) → zustand 로그아웃        

  백업 시스템 기인 (Android만)

  - 위 2번의 A/B/C (torn state, session-cookie 다운그레이드, stale token rotation) 경로
  - 앱 업데이트 후 WebView 쿠키 초기화(task.md 주석에 명시된 원래 유스케이스) — 근데 이 경로는 restore가  
  정상 동작해야 커버 가능. httpOnly/expires 소실 때문에 불완전.

  iOS 특유

  - WKWebView persistent store는 기본적으로 매우 튼튼. 앱 업데이트/재시작 살아남음
  - 디바이스 저장 공간 부족 시 iOS가 WebKit 데이터 정리(드묾)
  - iOS에서 "갑자기 풀림"은 대부분 서버/만료 기인. 백업 시스템 미동작으로 인한 풀림은 없음(애초에 안 돌고 
  있으니).

  4. AsyncStorage에 refresh token 저장 + 주기 동기화 — 권장 안 함

  현 구조의 근본 반패턴

  "WebView cookie jar"와 "AsyncStorage snapshot" 두 개의 source of truth가 존재. 어느 쪽이 권위인지       
  명확하지 않음. 동기화 간격이 짧을수록 in-flight 갱신과 겹칠 확률 증가 → torn state 더 자주 발생.        

  주기 동기화가 해결 못 하는 것

  - 2번의 A(in-flight race): 주기 짧을수록 오히려 악화. backup 호출 시점에 Set-Cookie가 진행 중일 확률    
  상승.
  - 2번의 B(httpOnly/expires 소실): 동기화 빈도와 무관. API 자체의 한계.
  - 2번의 C(rotation stale): 동기화 빈도로는 못 잡음. 오히려 stale 스냅샷이 더 자주 덮어쓰는 창 생성.     

  보안 측면

  - AsyncStorage는 Android SharedPreferences / iOS NSUserDefaults 기반. 평문 저장. 탈옥/루팅 기기에서 접근
   가능.
  - httpOnly 쿠키의 핵심 이점(JS/앱 코드 노출 차단)을 포기하게 됨.

  권고 순위

  1순위 — 백업 제거 검토.
  - iOS는 WKWebView persistent store로 이미 잘 버팀. 백업 비활성.
  - Android의 "앱 업데이트 시 쿠키 초기화"가 실제로 현재 디바이스/버전에서 재현되는지 재현 테스트. 재현 안
   되면 전체 제거.
  - 재현돼도 CookieManager.flush()를 적절 시점에 호출하는 것만으로 해결될 가능성.

  2순위 — 정말 백업이 필수면 refactor:
  - 전체 쿠키 말고 refreshToken만 저장
  - expo-secure-store 사용 (iOS Keychain / Android Keystore, 암호화)
  - 동기화 트리거를 AppState가 아니라 웹에서의 명시적 이벤트(AUTH_STATE_CHANGED: login/refresh/logout)로 —
   이 이벤트 배선이 현재 빠져있는 게 모든 문제의 상류 원인
  - 복원도 cold start 시 WebView를 /api/auth/set-cookie?refreshToken=... 같은 전용 엔드포인트로 유도해서  
  서버가 쿠키를 다시 굽게 만들기 (httpOnly/expires/domain/path 전부 서버가 보장)

  3순위 — 서버 주도 검증: 앱 시작 시 lightweight ping → 401이면 로그인 화면. 백업 스토리지 아예 없음. UX  
  손실 = 앱 업데이트 후 1회 재로그인.

  주기 동기화는 2순위 내에서도 권장 안 함. 이벤트 기반이 깔끔. AppState 전이 + 일정 주기를 섞으면 race    
  표면적만 커짐.

  한 줄 결론

  백업 시스템은 Android 업데이트 시 쿠키 손실 하나를 해결하려다 torn state, 유령 로그인, 로그인 실패      
  race까지 떠안음. 현재 iOS 잔존 문제는 이 시스템과 별개(native clearAll 인자 문제). 두 문제는 독립적으로 
  다뤄야 함.
