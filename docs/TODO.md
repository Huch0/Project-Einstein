# Project Einstein – TODO (v0.3 Agent Architecture)# Project Einstein – 작업 TODO (ko)

This document tracks the migration from monolithic pipeline to tool-based agent orchestration system for GPT-5.이 문서는 엔티티 라이브러리 확장(v0.2)과 빌더 레지스트리 도입 작업의 진행상황을 추적합니다. 스키마는 OpenAPI 문서를 단일 출처로 유지합니다.

## 완료됨 ✅## 완료됨 ✅

### Phase 0: Foundation (Completed)- 권위 지침 갱신 (.github/instructions)

- ✅ Matter.js physics integration with custom pulley constraint (~0.001m error)  - v0.2 엔티티 라이브러리, SceneKind 레지스트리, 리졸버 규칙 반영

- ✅ SAM polygon visualization (SVG rendering in frontend)  - OpenAPI 3.0 스펙을 docs에 유지하도록 명시

- ✅ Dynamic detection IDs (massA/massB determined by GPT at runtime)- OpenAPI 3.0 스펙 스켈레톤 추가 (docs/entity-library.v0.2.openapi.yaml)

- ✅ Complete Rapier removal (files, imports, settings)  - Segments, LabelEnvelope v0.2, per-entity props, Mapping/Defaults, BuildSceneRequestV2/Response, Scene 최소 형태 정의

- ✅ Project structure reorganization (sim/physics/ module)  - /diagram/parse 경로 정의 + examples, 에러 응답(ErrorResponse) 추가

- ✅ Instruction file rewrite for v0.3 agent architecture  - SceneKind enum(pulley.single_fixed_v0, ramp.block_v0, pendulum.single_v0, spring_mass.single_v0) 명시

- ✅ Settings updated (MATTER_WORKER_* config, 10s timeout)- 백엔드 빌더 레지스트리 도입

- ✅ 5-second simulation duration (312 frames)  - app/sim/builders/__init__.py: 레지스트리 및 Builder 프로토콜

- ✅ Reset/Pause button fixes  - app/sim/builders/pulley_single_fixed_v0.py: v0.2 호환 풀리 빌더(질량 추정, 좌/우 매핑, 중력 힌트 반영)

  - app/sim/registry.py: 리졸버 규칙 및 build_scene_v2 엔트리 구현

- ✅ Frontend scene normalization pipeline (translate/scale, letterbox-aware clamps, normalization badge) replacing direct clamping drift

## 진행 중 🚧- 라우터 통합

- app/routers/diagram.py: v0.2 라벨 envelope({version, entities[{segment_id, type, props}]}) 생성

### Phase 1: Tool Implementation (Current Focus)  - v2 레지스트리 빌드를 우선 시도하고 실패 시 v1 빌더로 폴백

Create tool wrappers around existing pipeline stages with strict JSON contracts.- 테스트 초안 추가 (단위 검증)

- backend/tests/test_registry_pulley.py: 리졸버 결정성, v0.2 빌드, v0.1 호환성 확인

#### Backend Structure- 수동 실행 검증

- [ ] Create `backend/app/agent/` directory structure  - build_scene_v2 스니펫 실행으로 meta.resolver=v2, scene_kind=pulley.single_fixed_v0 확인

  - [ ] `agent/__init__.py`

  - [ ] `agent/tool_registry.py` - Tool schemas + registration## 진행 예정 ▶️

  - [ ] `agent/agent_context.py` - Conversation state management

  - [ ] `agent/tools/` directory- 빌더 확장

  - ramp.block_v0: 1개 질량 + 경사면, 마찰/중력 반영, 해석적 폴백 포함

#### Tool 1: `segment_image`  - pendulum.single_v0: 추 추가 + 피벗 길이 고정 거리 구속

- [ ] Create `agent/tools/segment_image.py`  - spring_mass.single_v0: 스프링상수/자연길이 기반 힘 모델

- [ ] Input: `{image_data, mode, sam_server_url}`- OpenAPI/스키마

- [ ] Output: `{segments: [{id, bbox, polygon_px, mask_path}], image: {width_px, height_px, image_id}}`  - Scene 스키마 세부 필드 확장(필요한 경우), 예제 payload 보강, 엔티티별 엄격 검증 강화

- [ ] Wrapper for `pipeline/sam_detector.py` (HTTP mode)- 에이전트/레이블러

- [ ] Unit test with mock SAM server response  - StubLabeler를 v0.2(type 기반) 출력으로 전환(현 라우터는 type/label 모두 허용)

  - GPT 프롬프트 템플릿 정리(STRICT JSON, 지원 타입 한정)

#### Tool 2: `label_segments`- 프론트엔드

- [ ] Create `agent/tools/label_segments.py`  - scene_kind/메타 디버그 노출, 파라미터 패널 개선, 에러/경고 토스트 추가

- [ ] Input: `{image_id, segments, context, use_vision}`- 테스트/품질

- [ ] Output: `{version: "v0.2", entities: [{segment_id, type, props}], confidence}`  - px→m 매핑 중심(원점)과 결정성(Property test) 강화

- [ ] Wrapper for `agent/labeler.py` (OpenAI GPT-4o-mini)  - CI에서 스키마-빌더 계약 위반 감지(예: OpenAPI 예제 파서 테스트)

- [ ] Unit test with curated segment data- 물리 워커

  - Rapier 제약(풀리/거리/스프링) 점진 도입, 빈/NaN 프레임 시 해석적 폴백 유지

#### Tool 3: `validate_scene_entities`

- [ ] Create `agent/tools/validate_entities.py`## 알려진 문제(버그 리포트) 🐞

- [ ] Input: `{entities, allow_incomplete}`

- [ ] Output: `{valid, scene_kind, warnings, missing_required, suggestions}`하늘색 이동 패치(시뮬레이션 오버레이)가 초록색 세그먼트 박스를 정확히 따라가지 않고, 화면 정중앙 근처로 끌려가거나 따로 움직여 보이는 현상.

- [ ] Logic: Apply resolver rules from `sim/registry.py`

  - ≥2 mass + 1 pulley → pulley.single_fixed_v0- 재현 조건(관찰)

  - 1 mass + 1 ramp → ramp.block_v0  - 업로드한 다이어그램에서 massA/massB, pulley, surface가 감지된 상태

  - 1 mass + 1 pendulum_pivot → pendulum.single_v0  - 프론트 재생 시 하늘색 패치가 초록 박스와 분리되어 중앙 부근에서 움직임

  - 1 mass + 1 spring → spring_mass.single_v0  - 디텍션 오버레이를 끄고(재생 중 자동 비노출) 봐도 하늘색 패치 위치가 어긋남

- [ ] Unit test with valid/invalid entity sets

- 원인 가설

#### Tool 4: `build_physics_scene`  1) 매핑 불일치: object-contain 레터박스 스케일(s)과 backend scale_m_per_px, 그리고 origin(이미지 중심) 사이에 오차가 남아 Δ를 잘못 픽셀화

- [ ] Create `agent/tools/build_scene.py`  2) 기준점 선택 오류: massA/massB ↔ scene.bodies(m1/m2) 매칭이 뒤바뀌거나 한 점만 사용되어 스케일 보정이 불안정

- [ ] Input: `{image, segments, entities, mapping, defaults}`  3) 절대좌표/상대좌표 혼선: 초기 프레임(t=0)에서 디텍션 박스가 기준이 되도록 Δ만 적용해야 하는데 절대 좌표가 일부 경로에서 섞여 들어감

- [ ] Output: `{scene: Scene, warnings, meta: {resolver, builder}}`  4) 초기 좌표 취득 시점 문제: containerRef의 getBoundingClientRect와 이미지 로딩 타이밍 차이로 offset/scale이 0 또는 잘못된 값으로 고정

- [ ] Wrapper for `sim/registry.py` `build_scene_v2()`  5) frames 포맷 불일치: rapier/analytic 프레임의 positions 키와 body id가 기대와 달라 Δ 계산에 실패해 0 또는 NaN이 fallback되어 중앙으로 수렴

- [ ] Unit test: validate Scene JSON schema compliance

- 임시 진단/확인 포인트

#### Tool 5: `simulate_physics`  - 디버그 로그에 다음 값을 출력하고 개발자도구에서 확인

- [ ] Create `agent/tools/simulate_physics.py`    - object-contain: s, renderW/H, offsetX/Y

- [ ] Input: `{scene, engine: "matter-js|analytic", duration_s, output_format}`    - backend mapping: scale_m_per_px

- [ ] Output: `{engine, frames, energy, summary, meta}`    - calibration 결과: containerPxPerMeter, originPxX/Y, 사용한 ref body ids와 det centers(px), init(world m)

- [ ] Wrapper for `sim/physics/matter_bridge.py` + `analytic.py`    - frameBodies[cur]와 initialPos[init]의 Δ(m) 및 Δ(px)

- [ ] Unit test: mock scene → validate frame structure  - scene.kind, frames 구조(positions vs bodies), id 키(m1/m2) 확인

#### Tool 6: `analyze_simulation`- 수정/대응 계획 체크리스트

- [ ] Create `agent/tools/analyze_results.py`  - [ ] 재생 직전 1프레임에 “정합 검사(예상 px vs 디텍션 센터 px)”를 수행하고, 오차가 임계값 초과 시 보정(ox/oy/s) 재계산

- [ ] Input: `{frames, scene, analysis_type}`  - [ ] 캘리브레이션 2점 실패 시에도 최소 1점 기준으로 원점(ox/oy)을 강제 정렬하고, 스케일은 델타의 크기 변화로 미세 보정

- [ ] Output: `{energy_conservation, constraint_violations, motion_summary}`  - [ ] massA/massB ↔ m1/m2 고정 수동 매핑 UI 추가(디폴트는 최근 자동 매핑 유지)

- [ ] Logic: Compute energy drift, constraint errors, pedagogical insights  - [ ] meta.debug에 builder_request와 scene_summary 이미 존재 → 여기에 detection centers(px)와 scene 초기 바디 px 좌표를 서버가 계산해 함께 내려주도록 확장(선택)

- [ ] Unit test: synthetic frames → verify analysis output  - [ ] 프레임 소스가 analytic일 때 positions 딕셔너리 키가 m1/m2인지 강제 검증하고 아니면 매핑 교정

  - [ ] 렌더 루프 초기화 시 이미지 로딩 완료/컨테이너 rect 확정 이후에만 캘리브레이션 수행하도록 useLayoutEffect/이미지 onLoad 연계

### Phase 2: Tool Registry & Agent Endpoint  - [ ] 테스트 스냅샷: 고정 이미지(샘플)에서 t=0 프레임의 하늘색 패치 중심과 디텍션 박스 중심 간 오차(px)가 < 1px임을 단정

- [ ] Implement `agent/tool_registry.py`

  - [ ] Define Pydantic models for each tool I/O- 수용 기준(AC)

  - [ ] Register tools in OpenAI function calling format  - t=0에서 각 하늘색 패치 중심과 해당 초록 박스 중심 오차 < 1px

  - [ ] Validation layer for tool inputs/outputs  - t>0에서 Δ(px)의 방향/크기가 analytic 또는 rapier 프레임의 Δ(m)×scale과 ±1px 이내로 일치

  - [ ] Error handling with user-friendly messages  - massA/massB 자동 매핑 실패 시에도 UI로 바꿀 수 있으며, 바꾼 뒤엔 위 AC를 만족

- [ ] Create `agent/agent_context.py`## 참고 파일 📚

  - [ ] ConversationContext class (conversation_id, segments, entities, scene, frames)

  - [ ] State persistence (in-memory dict for MVP, Redis/DB later)- 지침: `.github/instructions/instruction.instructions.md`

  - [ ] Context serialization/deserialization- OpenAPI: `docs/entity-library.v0.2.openapi.yaml`

- 레지스트리: `backend/app/sim/registry.py`

- [ ] Create agent chat endpoint- 빌더: `backend/app/sim/builders/pulley_single_fixed_v0.py`

  - [ ] Add `routers/agent.py`- 라우터: `backend/app/routers/diagram.py`

  - [ ] `POST /agent/chat` endpoint- 테스트: `backend/tests/test_registry_pulley.py`

    - Input: `{message, conversation_id?, attachments?}`
    - Output: `{assistant_message, tool_calls?, state}`
  - [ ] Integrate OpenAI function calling
  - [ ] Multi-turn conversation handling
  - [ ] Tool result processing + context update

### Phase 3: Testing & Validation

- [ ] Tool unit tests (6 tools × 2-3 tests each = ~15 tests)
- [ ] Agent integration tests
  - [ ] Multi-turn conversation: upload image → segment → label → validate → build → simulate
  - [ ] Error recovery: missing entities → agent asks clarifying questions
  - [ ] Iterative refinement: user corrects label → rebuild scene
- [ ] End-to-end test
  - [ ] Upload pulley diagram → natural language chat → get simulation frames
  - [ ] Verify: agent orchestrates correct tool sequence without user intervention

### Phase 4: Migration & Documentation

- [ ] Keep `/diagram/parse` for backward compatibility
  - [ ] Add deprecation notice in docstring
  - [ ] Redirect to agent tools internally (optional)
- [ ] Update API documentation
  - [ ] Add agent endpoint to OpenAPI spec
  - [ ] Document tool schemas
  - [ ] Add conversation flow examples
- [ ] Update frontend to use agent chat API
  - [ ] New chat component for natural language interaction
  - [ ] Display tool calls + intermediate results
  - [ ] Allow user corrections at each stage

## 진행 예정 ⏭️

### Builder Extensions (Post-Agent)

- [ ] `ramp.block_v0` builder
  - 1 mass + ramp, friction/gravity, analytic fallback
- [ ] `pendulum.single_v0` builder
  - 1 mass + pivot, fixed-distance constraint
- [ ] `spring_mass.single_v0` builder
  - Spring constant/natural length force model

### Advanced Features

- [ ] OpenAPI 3.0 spec for agent tools
  - Define all tool schemas in `docs/agent-tools.v0.3.openapi.yaml`
- [ ] Agent prompt engineering
  - Strict JSON mode for tool calls
  - Pedagogical analysis templates
  - Error recovery strategies
- [ ] Frontend improvements
  - scene_kind/meta debug display
  - Parameter panel for manual adjustments
  - Error/warning toasts
- [ ] Property tests
  - px→m mapping determinism around image center
  - Scene build idempotence
  - Energy conservation validation

## 알려진 이슈 🐞

### (Resolved) Alignment Bug

Previously: Cyan simulation patches not following green detection boxes → __FIXED by Matter.js + polygon calibration__

### Current Issues

None critical. Monitor:

- Matter.js constraint error (~0.001m acceptable)
- Tool call timeout (10s limit for SAM/GPT)
- OpenAI API rate limits

## 참고 파일 📚

### Core Documentation

- __Instruction__: `.github/instructions/instruction.instructions.md` (v0.3 agent architecture)
- __OpenAPI__ (upcoming): `docs/agent-tools.v0.3.openapi.yaml`

### Backend

- __Physics__: `app/sim/physics/matter_bridge.py`, `app/sim/physics/analytic.py`
- __Builders__: `app/sim/builders/pulley_single_fixed_v0.py`
- __Registry__: `app/sim/registry.py`
- __Schemas__: `app/sim/schema.py`
- __Routes__: `app/routers/diagram.py` (monolithic, to be wrapped)
- __Agent__ (upcoming): `app/agent/tools/*.py`, `app/agent/tool_registry.py`

### Frontend

- __Simulation__: `src/components/simulation/simulation-layer.tsx` (polygon rendering)
- __Context__: `src/lib/SimulationContext.tsx` (state management)
- __API__: `src/lib/api.ts` (DiagramParseDetection)

### Tests

- __Registry__: `tests/test_registry_pulley.py`
- __Agent__ (upcoming): `tests/test_agent_tools.py`

## Acceptance Criteria (v0.3) 🎯

### Phase 1 (Tool Implementation)

- ✅ Each tool callable independently with valid JSON I/O
- ✅ Tool unit tests pass (mock inputs → validate outputs)
- ✅ Existing `/diagram/parse` tests still green

### Phase 2 (Agent Endpoint)

- ✅ `POST /agent/chat` orchestrates full pipeline through natural language
- ✅ Multi-turn conversation maintains state correctly
- ✅ User can correct intermediate results (labels, scene params)

### Phase 3 (End-to-End)

- ✅ Upload pulley diagram → chat "simulate this" → get frames + analysis
- ✅ Error handling: missing entities → agent asks clarifying questions
- ✅ Iterative refinement: user edits label → scene updates correctly

### Phase 4 (Migration)

- ✅ Backward compatibility: old API clients still work
- ✅ Documentation updated: OpenAPI spec, README, tutorial
- ✅ Frontend uses agent chat for new workflows
