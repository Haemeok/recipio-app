// WebView 안의 console.log/warn/error를 RN 측으로 postMessage 송신.
// useBridge가 onMessage에서 type === 'CONSOLE'을 받아 RN 콘솔에 재출력한다.
// 디버깅 전용. prod에서도 활성 상태로 두는 것은 의도 — auth/login 진단에 활용.
export const CONSOLE_BRIDGE_SCRIPT = `
  (function() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = function(...args) {
      originalLog.apply(console, args);
      window.ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'CONSOLE',
        payload: { level: 'log', message: args.map(a => String(a)).join(' ') }
      }));
    };

    console.warn = function(...args) {
      originalWarn.apply(console, args);
      window.ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'CONSOLE',
        payload: { level: 'warn', message: args.map(a => String(a)).join(' ') }
      }));
    };

    console.error = function(...args) {
      originalError.apply(console, args);
      window.ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'CONSOLE',
        payload: { level: 'error', message: args.map(a => String(a)).join(' ') }
      }));
    };

    true;
  })();
`;
