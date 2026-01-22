# Recipio App - 프로젝트 규칙

## 아키텍처: Feature-Sliced Design (FSD)

### 레이어 구조 (상위 → 하위)

```
src/
├── app/          # 앱 초기화, 프로바이더, 글로벌 설정
├── pages/        # 페이지 컴포넌트 (라우트 단위)
├── widgets/      # 독립적인 UI 블록 (여러 feature 조합)
├── features/     # 사용자 시나리오, 비즈니스 기능
├── entities/     # 비즈니스 엔티티 (도메인 모델)
└── shared/       # 재사용 가능한 유틸리티, UI, 타입
```

### 레이어별 규칙

#### `shared/` - 공유 모듈
- 비즈니스 로직 없음
- 순수 유틸리티, UI 컴포넌트, 타입, 상수
- 세그먼트: `ui/`, `lib/`, `api/`, `config/`, `types/`

#### `entities/` - 엔티티
- 비즈니스 도메인 모델
- 다른 entity 참조 금지

#### `features/` - 기능
- 사용자 액션 단위
- entities, shared만 참조 가능

#### `widgets/` - 위젯
- 독립적인 UI 블록
- features, entities, shared 참조 가능

#### `pages/` - 페이지
- 라우트별 컴포넌트
- 모든 하위 레이어 참조 가능

#### `app/` - 앱
- 앱 설정, 프로바이더
- 모든 레이어 참조 가능

### 슬라이스 내부 구조

```
feature-name/
├── ui/           # 컴포넌트
├── model/        # 비즈니스 로직, 스토어, 타입
├── api/          # API 호출
├── lib/          # 유틸리티
└── index.ts      # Public API (필수)
```

### 핵심 규칙

1. **단방향 의존성**: 상위 레이어 → 하위 레이어만 참조
2. **Public API**: 슬라이스 외부에선 반드시 `index.ts`를 통해 접근
3. **단일 책임**: 각 슬라이스는 하나의 기능/도메인만 담당
4. **격리**: 같은 레이어 내 슬라이스 간 직접 참조 금지

### 네이밍 컨벤션

- 폴더: kebab-case (`haptic-bridge/`)
- 컴포넌트: PascalCase (`HapticButton.tsx`)
- 유틸/훅: camelCase (`useHaptic.ts`, `hapticService.ts`)
- 타입: PascalCase (`HapticStyle`)
- 상수: SCREAMING_SNAKE_CASE (`HAPTIC_TYPES`)
