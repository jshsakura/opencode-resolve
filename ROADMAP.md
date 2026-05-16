# OpenCode Resolve: 만능 해결사(Universal Troubleshooter) 개선 계획

본 문서는 `opencode-resolve`가 단순한 코딩 어시스턴트를 넘어, 가볍고 확실하게 작업을 완수하는 **"만능 해결사"**로 진화하기 위한 논리적 개선 로드맵을 담고 있습니다.

표기 규약:
- `[기존]` — 이미 구현된 도구/메커니즘 (확장 대상)
- `[확장]` — 기존 도구의 출력/동작을 강화
- `[신규]` — 새 도구 또는 새 로직 추가

---

## 🎯 비전: "Less Context, More Evidence, Zero Loop"
- **Less Context:** 불필요한 전체 파일을 읽지 않고 핵심 정보만 추출.
- **More Evidence:** 모든 수정은 자동화된 검증(LSP, Test, Lint) 증거를 동반.
- **Zero Loop:** 동일한 실패 패턴을 감지하고 스스로 전략을 수정하여 무한 루프 차단.

정체성: **토큰 효율**이 모든 결정의 1순위 기준.

**안전 원칙 (Phase 1 절대 규칙):**
1. **신규 도구 0개.** 새 도구 스키마는 모든 세션에 상주 비용을 발생시키므로 Phase 1에서는 기존 도구 확장만 허용.
2. **모든 변경은 무조건 net positive.** "사용 안 하는 세션엔 손해" 시나리오가 단 하나라도 있으면 채택 금지. 기본 동작은 기존과 동일하거나 더 작은 출력을 보장하고, 추가 정보는 옵트인 플래그로만.
3. **회귀 테스트.** 기존 테스트(36건) 모두 통과 + 각 변경마다 "출력 크기 ≤ 기존" 검증 테스트 1건 추가.

---

## 🛠 6대 개선 과제

> 기존 7개 중 **다국어 지원(구 5번)** 은 정체성 전환급 결정이므로 별도 섹션(v0.2 후보)으로 분리.

### 1. 지능형 진단 및 자동 수정 (LSP Quick Fix 연동)
- [신규] **LSP Code Actions 도구:** `resolve-quickfix` — `resolve-diagnostics`(기존)가 잡은 에러에 대해 LSP가 제안하는 Quick Fix 목록을 조회·적용. OpenCode 플러그인 API에서 Code Action 호출이 가능한지 먼저 검증 필요.
- [확장] **에러 문맥 강화:** `resolve-diagnostics` 응답에 에러 라인 주변 ±5줄과 referenced 심볼의 타입 정의 경로를 같이 반환. coder가 별도 read 호출을 줄임 → 순수 토큰 절감.

### 2. 고성능 테스트 로그 분석기 (Smart Test Scouter)
- [확장] **`resolve-test` 프레임워크 어댑터:** Vitest / Jest / Pytest / Go test 출력을 파싱하여 `실패 테스트명`, `expected vs received`, `핵심 스택 프레임 3줄`만 반환. raw 로그는 옵션 플래그(`raw: true`)로만 노출.
- [신규] **요약 임계치:** 출력이 N줄 초과 시 자동으로 요약 모드로 폴백. 토큰 절감 효과가 가장 큰 항목.

### 3. 에이전트 간 공유 지식창고 (Shared Blackboard)
- [확장] **`resolve-state` 동적 주입:** 저장된 "배운 점"을 이후 도구 응답 헤더에 prepend. (OpenCode 플러그인이 system prompt를 세션 중간에 mutate 할 수 있는지 SDK 확인 후, 가능하면 prompt 주입 / 불가능하면 tool response prepend로 우회.)
- [확장] **Hotspot 경고:** `resolve-changelog`(기존)와 결합해 같은 파일이 3회 이상 수정되면 다음 `resolve-session` 호출 결과 상단에 "이 파일은 의존성이 복잡할 수 있음" 힌트 출력.

### 4. 논리적 가드레일 (Design-First Guidance)
> **강제 라우팅이 아닌 권고/경고로 구현.** 강제는 [[two_tier_design]] 결정(3-tier가 decision fatigue로 거부됨)과 같은 함정.
- [확장] **Complexity 권고:** `resolve-complexity`(기존) 결과가 임계치를 넘으면 응답에 "이 변경은 `planner`/`architect`를 먼저 호출하는 것을 권장합니다" 한 줄 추가. resolver의 자율 판단을 보조하되 강제하지 않음.
- [신규] **Dry-run 모드:** `resolve-init`에 `--dry-run` 옵션 추가 — 실제 변경 없이 예상 파일 목록만 출력.

### 5. 자기 진화형 전략 피벗 (Self-Correction Logic)
- [확장] **`resolve-session` 실패 패턴 감지 강화:** 동일 에러 메시지 3회 이상 반복 시 `loopWarning` 필드에 "현재 접근 재고 권장 — `debugger` 호출 또는 가설 재정립 고려" 추가. (강제 교체가 아닌 가시화. 플러그인이 라우팅 강제는 어려움.)
- [확장] **resolver 프롬프트 보강:** "가설을 먼저 명시한 뒤 최소 단위 실험으로 검증" 절차를 시스템 프롬프트에 명문화. 도구 추가 없이 프롬프트만으로 처리.

### 6. 완벽한 마무리 (Finalization & Delivery)
- [확장] **`resolve-session` 옵트인 `full` 모드:** 인자에 `full: true`를 주면 changelog/state 요약까지 한 번에 반환. 기본 호출은 기존과 100% 동일. 신규 도구 추가 없이 3회 호출 → 1회 단축 가능.
- [보류] **Smart Commit Generator:** LLM이 프롬프트 안에서 이미 잘 수행. 도구화 ROI 낮음. Phase 3 옵션으로 보류.

---

## 🌐 v0.2 별도 결정 사항: 다국어/멀티 에코시스템

현재 코드(`postinstall`, `resolve-deps`, `resolve-outdated`, `resolve-init`, README 템플릿)는 JS/TS·`package.json` 중심. Python/Go/Rust 확장은 **정체성 전환급 결정**이므로 7개 과제의 일부가 아닌 별도 마일스톤으로 다룸.

작게 시작한다면:
- [확장] `resolve-context` / `resolve-verify`의 언어 감지를 일반화 (lockfile 존재 여부로 분기)
- 별도 도구 분리는 사용 사례가 누적된 뒤 결정

---

## 📅 단계별 실행 계획

### Phase 1: 토큰 절감 즉시 효과 (Short-term)
**모든 항목 신규 도구 0개. 기본 동작은 기존과 동일, 추가 효과는 옵트인 또는 자동 축소만.**
- [ ] **0. 측정 베이스라인** — `SessionState`에 누적 출력 바이트 카운터 추가, `resolve-session` 응답에 표시. 신규 필드만 추가, 기존 필드 변경 없음.
- [ ] 2번 — `resolve-test` 출력 파서. 기본 동작이 기존보다 항상 더 작거나 같음(요약). `raw: true` 플래그로 원본 폴백 보장.
- [ ] 1번 후반부 — `resolve-diagnostics`: 에러가 존재할 때만 ±3줄 컨텍스트 추가, `context: false`로 끄기 가능. 에러 없는 호출은 출력 변화 0.
- [ ] 6번 — `resolve-session`에 `full: true` 옵션 추가(기본 false = 기존과 동일).

### Phase 2: 지능화 (Mid-term, 플러그인 API 검증 후)
- [ ] 1번 전반부 — LSP Quick Fix 자동 적용 (`resolve-quickfix`)
- [ ] 3번 — Blackboard 동적 주입 + Hotspot 경고
- [ ] 4번 — Complexity 권고 메시지 + `resolve-init --dry-run`

### Phase 3: 자율성 완성 (Long-term)
- [ ] 5번 — 실패 패턴 감지 강화 + resolver 가설 검증 프롬프트
- [ ] (옵션) Smart Commit Generator
- [ ] v0.2 다국어 확장 (별도 결정)

---

## 🚨 릴리스 규약 (CLAUDE.md 연동)

각 Phase 종료 시:
1. 새 도구는 `getTools()` 등록 + `test/*.mjs` 테스트 1건 이상
2. 새 agent 이름 / 모델 alias / 최상위 config 키 추가 시 [[schema_sync_trap]] 따라 동일 PR에서 릴리스
3. `gh workflow run "Publish to npm" --repo jshsakura/opencode-resolve -f version=patch` 로 배포 (수동 `npm publish` 금지)
4. README.md ↔ README.ko.md 동기화 필수 (drop-in 템플릿이 install 계약)

---
*이 계획은 실제 개발 진행 상황에 따라 유연하게 변경될 수 있습니다.*
