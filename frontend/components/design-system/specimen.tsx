"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronRight,
  Component,
  Layers,
  LayoutGrid,
  Moon,
  Palette,
  SlidersHorizontal,
  Sun,
  Type,
  Workflow,
} from "lucide-react";
import { LuminousButton as Button } from "./controls";
import { Input } from "@/components/ui/input";
import {
  BreakdownCard,
  DataStateCard,
  EvidenceCard,
  ExpertCard,
  MetricCard,
  TrendCard,
  WorkflowCard,
  type DataState,
} from "./cards";
import { StatusBadge, Surface, type SurfaceDensity } from "./surface";
import { ImprintContours, ImprintMark } from "./imprint";
import "./luminous.css";
import styles from "./specimen.module.css";

const NAV = [
  { id: "cards", label: "카드 라이브러리", icon: LayoutGrid },
  { id: "workflow", label: "워크플로", icon: Workflow },
  { id: "brand", label: "브랜드 표현", icon: Layers },
  { id: "foundations", label: "색과 표면", icon: Palette },
  { id: "typography", label: "타이포그래피", icon: Type },
  { id: "controls", label: "컨트롤", icon: SlidersHorizontal },
  { id: "states", label: "상태와 피드백", icon: Component },
] as const;

const COLORS = [
  { name: "Mist", hex: "#F3F7F8", token: "canvas", role: "공간의 바탕" },
  { name: "White", hex: "#FFFFFF", token: "paper", role: "집중하는 표면" },
  { name: "Ink", hex: "#19343A", token: "ink", role: "선명한 정보" },
  { name: "Teal", hex: "#176B64", token: "accent", role: "주요 행동" },
  { name: "Mint", hex: "#DCEFE6", token: "mint", role: "차분한 온기" },
  { name: "Sky", hex: "#DEECF8", token: "sky", role: "부드러운 깊이" },
] as const;

const WEEK = [
  { label: "9.24", value: 12 },
  { label: "9.25", value: 19 },
  { label: "9.26", value: 16 },
  { label: "9.27", value: 25 },
  { label: "9.28", value: 21 },
  { label: "9.29", value: 32 },
  { label: "9.30", value: 28 },
];
const MONTH = [
  { label: "9.1–5", value: 64 },
  { label: "9.6–10", value: 81 },
  { label: "9.11–15", value: 73 },
  { label: "9.16–20", value: 98 },
  { label: "9.21–25", value: 114 },
  { label: "9.26–30", value: 122 },
];
const STAGES = [
  {
    title: "사실 수집",
    description: "질문에서 사실과 빠진 정보를 구분합니다.",
    state: "complete" as const,
    detail:
      "질문 예시 · 사업용 장비를 언제 구입했나요? 누가 사용하나요? 확인한 사실을 다음 단계로 전달합니다.",
  },
  {
    title: "답변 생성",
    description: "확인된 사실과 근거로 답변을 구성합니다.",
    state: "active" as const,
    detail:
      "답변 예시 · 앞 단계에서 확인한 사실을 바탕으로 근거를 찾고, 판단과 한계를 함께 설명합니다.",
  },
  {
    title: "전문가 연결",
    description: "사람의 판단이 필요한 순간을 살핍니다.",
    state: "waiting" as const,
    detail:
      "연결 예시 · 추가 확인이나 전문가 판단이 필요한지 검토합니다. 실행 상태는 시각 표현을 위한 예시입니다.",
  },
];

function SectionHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.sectionHeading}>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}

function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.choiceGroup} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function DesignSystemSpecimen() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [density, setDensity] = useState<SurfaceDensity>("comfortable");
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [stage, setStage] = useState(1);
  const [dataState, setDataState] = useState<DataState>("ready");
  const [agentName, setAgentName] = useState("나의 세무 상담 에이전트");
  const [savedName, setSavedName] = useState("");
  const [formError, setFormError] = useState("");
  const [notify, setNotify] = useState(true);

  function saveExample(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agentName.trim()) {
      setFormError("에이전트 이름을 입력해 주세요.");
      setSavedName("");
      return;
    }
    setFormError("");
    setSavedName(agentName.trim());
  }

  return (
    <div
      className={`luminous ${styles.root}`}
      data-theme={theme}
      data-density={density}
    >
      <a href="#main-content" className={styles.skipLink}>
        본문으로 바로가기
      </a>
      <aside className={styles.sidebar} aria-label="디자인 시스템 탐색">
        <Link href="/design-system" className={styles.brand}>
          <Layers size={24} strokeWidth={1.6} aria-hidden="true" />
          <span>
            neo-luddite<span>Design system</span>
          </span>
        </Link>
        <nav className={styles.navigation} aria-label="섹션">
          {NAV.map(({ id, label, icon: Icon }) => (
            <a href={`#${id}`} key={id}>
              <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
              {label}
            </a>
          ))}
        </nav>
        <div className={styles.sidebarFoot}>
          <span className={styles.editionDot} aria-hidden="true" />
          <span>
            Luminous edition
            <br />
            <small>빛과 여백의 워크스페이스</small>
          </span>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>
            <span>워크스페이스</span>
            <ChevronRight size={13} aria-hidden="true" />
            <strong>디자인 시스템</strong>
          </div>
          <div className={styles.topbarActions}>
            <button
              type="button"
              className={styles.themeButton}
              aria-label={
                theme === "light" ? "다크 모드로 전환" : "라이트 모드로 전환"
              }
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <Link href="/login" className={styles.workspaceLink}>
              프로토타입 열기
              <ArrowUpIcon />
            </Link>
          </div>
        </header>
        <main id="main-content" className={styles.main}>
          <div className={styles.intro}>
            <div>
              <h1>명료함에 여유를 더하다.</h1>
              <p>
                빛이 스며드는 표면, 편안한 간격, 선명한 정보.
                <br />
                Neo-Luddite의 새로운 디자인 시스템입니다.
              </p>
            </div>
            <a href="#foundations" className={styles.introLink}>
              디자인 원칙 살펴보기
              <ArrowDown size={16} aria-hidden="true" />
            </a>
          </div>

          <section
            id="cards"
            className={styles.section}
            aria-label="카드 라이브러리"
          >
            <SectionHeading
              title="정보마다 알맞은 형태"
              description="수치, 근거, 사람. 각 정보의 성격을 담은 여섯 가지 카드."
            >
              <ChoiceGroup
                label="카드 간격"
                value={density}
                onChange={setDensity}
                options={[
                  { value: "comfortable", label: "여유롭게" },
                  { value: "compact", label: "촘촘하게" },
                ]}
              />
            </SectionHeading>
            <p className={styles.exampleNote}>
              모든 수치·문서·인물은 디자인 검토용 예시입니다.
            </p>
            <div className={styles.dataGrid}>
              <MetricCard
                title="함께 살핀 상담"
                value="128"
                unit="건"
                description="2026년 9월 · 전문가 검토 예시"
                footer={
                  <span className={styles.metricFooter}>
                    <span className={styles.miniAvatars} aria-hidden="true">
                      <i>김</i>
                      <i>박</i>
                      <i>이</i>
                    </span>
                    <span>전문가 3명이 함께했어요</span>
                  </span>
                }
              />
              <TrendCard
                title="상담 흐름"
                data={period === "week" ? WEEK : MONTH}
                period={period === "week" ? "9월 24일–30일" : "9월 1일–30일"}
                comparison={
                  period === "week"
                    ? "이전 7일 대비 27.5%"
                    : "이전 30일 대비 20%"
                }
                action={
                  <ChoiceGroup
                    label="상담 흐름 기간"
                    value={period}
                    onChange={setPeriod}
                    options={[
                      { value: "week", label: "7일" },
                      { value: "month", label: "30일" },
                    ]}
                  />
                }
              />
              <BreakdownCard
                title="상담의 다음 단계"
                items={[
                  { label: "답변 완료", value: 72, tone: "mint" },
                  { label: "추가 확인", value: 18, tone: "sky" },
                  { label: "전문가 연결", value: 10, tone: "amber" },
                ]}
              />
            </div>
            <div className={styles.contentGrid}>
              <EvidenceCard
                title="답변을 뒷받침하는 맥락까지"
                source="샘플 지식 베이스 · 문서 04"
                excerpt="사업용 장비에 대한 질문이라면, 먼저 구입 시점과 사용 목적을 확인합니다. 확인된 사실과 아직 필요한 정보를 구분해 다음 판단의 출발점을 만듭니다."
                detail="이 예시 문서는 사실 수집 단계에서 어떤 맥락을 남기는지 보여줍니다. 출처, 인용문, 추가 설명을 함께 제공해 전문가가 판단의 흐름을 따라갈 수 있도록 합니다."
              />
              <ExpertCard
                name="박서연"
                specialty="소상공인과 함께하는 세무 상담"
                topics={["사업 시작", "사업용 자산", "신고 준비"]}
              />
            </div>
          </section>

          <section id="workflow" className={styles.section}>
            <SectionHeading
              title="흐름이 보이는 작업 공간"
              description="단계를 선택하면 그 역할과 전달되는 맥락을 살펴볼 수 있어요."
            />
            <div
              className={styles.workflowGrid}
              role="group"
              aria-label="워크플로 단계 예시"
            >
              {STAGES.map((item, index) => (
                <div key={item.title} className={styles.workflowItem}>
                  <WorkflowCard
                    {...item}
                    index={index + 1}
                    selected={stage === index}
                    onSelect={() => setStage(index)}
                  />
                  {index < STAGES.length - 1 ? (
                    <ArrowRight
                      className={styles.connector}
                      size={18}
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <div className={styles.workflowDetail} aria-live="polite">
              <span>{STAGES[stage].title}</span>
              <p>{STAGES[stage].detail}</p>
            </div>
          </section>

          <section id="brand" className={styles.section}>
            <SectionHeading title="전문성의 흔적, Imprint" description="전문가의 경험이 이어지는 모습을 하나의 열린 선으로 표현합니다." />
            <div className={styles.brandExpression}>
              <div className={styles.brandIdentity}><ImprintMark size={48} /><strong>세무상담</strong></div>
              <ImprintContours className={styles.brandContours} />
              <p>첫인상을 만드는 랜딩, 로그인, 브랜드 콘텐츠에 사용합니다. 상담 내용과 입력 폼에는 여백을 남깁니다.</p>
            </div>
            <p className={styles.exampleNote}>브랜드의 초록은 역할·승인 상태를 뜻하지 않습니다. 전문가는 파랑, 운영자는 앰버의 기존 작업 환경을 유지합니다.</p>
          </section>

          <section id="foundations" className={styles.section}>
            <SectionHeading
              title="색은 은은하게, 표면은 입체적으로"
              description="차가운 흰색에 민트와 하늘빛을 더하고, 짙은 잉크색으로 중심을 잡습니다."
            />
            <div className={styles.palette}>
              {COLORS.map((color) => (
                <div key={color.name} className={styles.colorItem}>
                  <div
                    className={styles.colorSample}
                    style={{ background: color.hex }}
                  />
                  <div>
                    <strong>{color.name}</strong>
                    <code>{color.hex}</code>
                    <span>{color.role}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className={styles.paletteNote}>
              기본 라이트 팔레트 · 다크 모드에서는 같은 역할의 색을 어두운
              표면에 맞게 조정합니다.
            </p>
            <div className={styles.materialStage}>
              <Surface material="glass">
                <Layers size={22} aria-hidden="true" />
                <h3>빛이 통하는 표면</h3>
                <p>탐색과 도구 모음은 배경의 색을 은은하게 받아들입니다.</p>
                <span>Glass · 탐색과 도구</span>
              </Surface>
              <Surface tone="mint" material="tinted">
                <Palette size={22} aria-hidden="true" />
                <h3>색이 머무는 표면</h3>
                <p>핵심 수치와 요약은 부드러운 색면으로 구분합니다.</p>
                <span>Tinted · 요약과 지표</span>
              </Surface>
              <Surface>
                <Type size={22} aria-hidden="true" />
                <h3>읽기에 집중하는 표면</h3>
                <p>긴 문장과 입력 영역은 안정적인 불투명 표면에 담습니다.</p>
                <span>Solid · 읽기와 편집</span>
              </Surface>
            </div>
            <div className={styles.principles}>
              <p>
                <strong>여백이 만드는 질서</strong>페이지 32px · 카드 24px ·
                섹션 48px
              </p>
              <p>
                <strong>역할에 맞는 곡률</strong>컨트롤 10px · 카드 18px · 패널
                24px
              </p>
              <p>
                <strong>필요한 만큼의 깊이</strong>카드는 낮게, 떠 있는 도구는
                한 단계 높게
              </p>
            </div>
          </section>

          <section id="typography" className={styles.section}>
            <SectionHeading
              title="오래 읽어도 편안한 글자"
              description="한글에 익숙한 Pretendard. 크기와 굵기, 행간으로 정보의 순서를 만듭니다."
            />
            <Surface className={styles.typeSpecimen}>
              <div className={styles.typeDisplay}>
                <span>화면 제목 · 32 / 600</span>
                <p>
                  복잡한 판단을,
                  <br />
                  선명한 이해로.
                </p>
              </div>
              <div className={styles.typeSamples}>
                <div>
                  <span>섹션 제목 · 20 / 550</span>
                  <h3>전문가의 시선이 닿는 곳</h3>
                </div>
                <div>
                  <span>본문 · 15 / 400</span>
                  <p>
                    충분한 여백은 정보를 찾는 시간을 줄여 줍니다. 서로 연결된
                    내용은 가까이, 새로운 이야기는 한 호흡 떨어뜨려 놓습니다.
                  </p>
                </div>
                <div>
                  <span>수치 · 가변폭 없는 숫자</span>
                  <p className={styles.typeNumbers}>
                    128,640 <small>건</small>
                  </p>
                </div>
                <div>
                  <span>보조 정보 · 13 / 400</span>
                  <p className="ds-muted">
                    마지막 수정 2026년 9월 30일 · 샘플 기록
                  </p>
                </div>
              </div>
            </Surface>
          </section>

          <section id="controls" className={styles.section}>
            <SectionHeading
              title="다음 행동을 명확하게"
              description="버튼, 입력, 선택. 모든 컨트롤이 같은 리듬으로 작동합니다."
            />
            <div className={styles.controlGrid}>
              <Surface>
                <h3 className={styles.exampleTitle}>행동의 우선순위</h3>
                <div className={styles.buttonExamples}>
                  <Button
                    className="ds-control"
                    onClick={() => {
                      document.getElementById("agent-name-example")?.focus();
                    }}
                  >
                    이름 편집
                    <ArrowRight size={15} />
                  </Button>
                  <Button
                    className="ds-control"
                    variant="outline"
                    onClick={() => {
                      setAgentName("나의 세무 상담 에이전트");
                      setSavedName("");
                      setFormError("");
                    }}
                  >
                    예시 초기화
                  </Button>
                  <Button
                    className="ds-control"
                    variant="ghost"
                    render={<a href="#states" />}
                  >
                    상태 살펴보기
                  </Button>
                  <Button className="ds-control" disabled>
                    게시 준비 중
                  </Button>
                </div>
                <p className={styles.controlHint}>
                  주요 행동은 짙은 색으로, 보조 행동은 가볍게.
                </p>
                <h3 className={styles.exampleTitle}>의미가 있는 상태</h3>
                <div className={styles.statusExamples}>
                  <StatusBadge tone="success">완료</StatusBadge>
                  <StatusBadge tone="info">진행 중</StatusBadge>
                  <StatusBadge tone="warning">확인 필요</StatusBadge>
                  <StatusBadge tone="danger">오류</StatusBadge>
                  <StatusBadge>대기</StatusBadge>
                </div>
              </Surface>
              <Surface>
                <form
                  onSubmit={saveExample}
                  noValidate
                  className={styles.exampleForm}
                >
                  <label htmlFor="agent-name-example">에이전트 이름</label>
                  <Input
                    id="agent-name-example"
                    className={styles.input}
                    value={agentName}
                    maxLength={60}
                    aria-invalid={!!formError}
                    aria-describedby={
                      formError ? "name-example-error" : "name-example-hint"
                    }
                    onChange={(event) => {
                      setAgentName(event.target.value);
                      setSavedName("");
                      setFormError("");
                    }}
                  />
                  <p id="name-example-hint" className="ds-muted">
                    화면 안에서만 바뀌는 입력 예시입니다.
                  </p>
                  {formError ? (
                    <p
                      id="name-example-error"
                      role="alert"
                      className={styles.formError}
                    >
                      {formError}
                    </p>
                  ) : null}
                  <label className={styles.toggleRow}>
                    <span>
                      검토가 필요할 때 알림
                      <span>켜짐과 꺼짐을 확인하는 예시</span>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={notify}
                      onChange={(event) => setNotify(event.target.checked)}
                    />
                    <span className={styles.switchTrack} aria-hidden="true" />
                  </label>
                  <div className={styles.formFoot}>
                    <Button className="ds-control" type="submit">
                      예시 적용
                      <Check size={15} />
                    </Button>
                    <span role="status">
                      {savedName ? `“${savedName}” 적용됨` : ""}
                    </span>
                  </div>
                </form>
              </Surface>
            </div>
          </section>

          <section id="states" className={styles.section}>
            <SectionHeading
              title="어떤 상태에서도 자연스럽게"
              description="결과가 없거나 기다리는 순간에도, 다음에 무엇을 할 수 있는지 알려줍니다."
            />
            <div className={styles.statesLayout}>
              <div className={styles.stateExplanation}>
                <ChoiceGroup
                  label="데이터 상태 선택"
                  value={dataState}
                  onChange={setDataState}
                  options={[
                    { value: "ready", label: "데이터 있음" },
                    { value: "loading", label: "로딩" },
                    { value: "empty", label: "비어 있음" },
                    { value: "error", label: "오류" },
                  ]}
                />
                <p>
                  상태를 바꾸어 같은 카드가 어떻게 반응하는지 확인해 보세요.
                  오류 상태의 ‘다시 불러오기’는 데이터가 있는 예시로 돌아갑니다.
                </p>
                <p className="ds-muted">
                  색과 함께 명확한 문장을 사용합니다. 로딩 중에도 공간을
                  유지하고, 키보드 포커스를 선명하게 표시합니다.
                </p>
              </div>
              <div aria-live="polite">
                <DataStateCard
                  state={dataState}
                  onRetry={() => setDataState("ready")}
                />
              </div>
            </div>
          </section>

          <footer className={styles.footer}>
            <span>
              Neo-Luddite <span>·</span> Luminous design system
            </span>
            <a href="#main-content">
              처음으로
              <ArrowDown size={13} aria-hidden="true" />
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}

function ArrowUpIcon() {
  return (
    <ArrowRight
      size={14}
      style={{ transform: "rotate(-45deg)" }}
      aria-hidden="true"
    />
  );
}
