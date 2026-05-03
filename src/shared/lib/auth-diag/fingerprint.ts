import * as Crypto from 'expo-crypto';

/**
 * SHA-256 첫 4바이트(8자 hex) — 백엔드/웹 `fingerprint`와 동일 포맷.
 * 빈 문자열은 빈 문자열을 반환 (로그에서 "쿠키 없음"과 구분 가능).
 */
export const tokenFingerprint = async (value: string): Promise<string> => {
  if (!value) return '';
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    value
  );
  return digest.slice(0, 8);
};

if (__DEV__) {
  // SHA-256("test") = 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
  void tokenFingerprint('test').then((fp) => {
    if (fp !== '9f86d081') {
      console.warn('[fingerprint] self-check failed — got', fp);
    }
  });
}
