import type { ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  FileText,
  MessageCircle,
  RotateCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";
import { LuminousButton as Button } from "./controls";
import { CardHeading, StatusBadge, Surface, type SurfaceTone } from "./surface";

export function MetricCard({
  title,
  value,
  unit,
  description,
  footer,
  tone = "mint",
}: {
  title: string;
  value: string;
  unit?: string;
  description: string;
  footer?: ReactNode;
  tone?: SurfaceTone;
}) {
  return (
    <Surface tone={tone} material="tinted" className="ds-metric">
      <CardHeading title={title} />
      <p className="ds-value">
        {value}
        <span>{unit}</span>
      </p>
      <p className="ds-muted">{description}</p>
      {footer ? <div className="ds-card-foot">{footer}</div> : null}
    </Surface>
  );
}

export type TrendPoint = { label: string; value: number };

export function TrendCard({
  title,
  data,
  period,
  comparison,
  action,
}: {
  title: string;
  data: TrendPoint[];
  period: string;
  comparison: string;
  action?: ReactNode;
}) {
  const total = data.reduce((sum, point) => sum + point.value, 0);
  return (
    <Surface tone="sky" material="tinted" className="ds-trend">
      <CardHeading title={title} detail={action} />
      <div className="ds-trend-summary">
        <p className="ds-value">
          {total.toLocaleString("ko-KR")}
          <span>건</span>
        </p>
        <span className="ds-comparison">
          <ArrowUpRight size={15} aria-hidden="true" />
          {comparison}
        </span>
      </div>
      <p className="ds-muted">{period} · 예시 데이터</p>
      {data.length > 1 ? (
        <div className="ds-chart">
          <Sparkline
            data={data.map((point) => point.value)}
            width={360}
            height={76}
            strokeWidth={2}
          />
          <div className="ds-chart-labels">
            <span>{data[0].label}</span>
            <span>{data[data.length - 1].label}</span>
          </div>
        </div>
      ) : (
        <p className="ds-muted">
          추세를 표시하려면 두 개 이상의 기록이 필요합니다.
        </p>
      )}
      <details className="ds-disclosure ds-chart-data">
        <summary>
          수치 보기
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <table>
          <caption>
            {title} — {period} 예시 수치
          </caption>
          <thead>
            <tr>
              <th scope="col">기간</th>
              <th scope="col">건수</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.label}>
                <th scope="row">{point.label}</th>
                <td>{point.value}건</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Surface>
  );
}

export function BreakdownCard({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number; tone: "mint" | "sky" | "amber" }[];
}) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  return (
    <Surface className="ds-breakdown">
      <CardHeading
        title={title}
        detail={<span className="ds-muted">총 {total}건</span>}
      />
      <p className="ds-breakdown-intro">
        필요한 곳에
        <br />
        <strong>전문가의 판단을.</strong>
      </p>
      <div className="ds-distribution" aria-hidden="true">
        {items.map((item) => (
          <span
            key={item.label}
            data-tone={item.tone}
            style={{ flexGrow: Math.max(0, item.value) }}
          />
        ))}
      </div>
      <ul className="ds-legend">
        {items.map((item) => (
          <li key={item.label}>
            <span
              className="ds-swatch-dot"
              data-tone={item.tone}
              aria-hidden="true"
            />
            <span>{item.label}</span>
            <strong>
              {item.value}
              <small>건</small>
            </strong>
            <span className="ds-muted">
              {total ? Math.round((item.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
      {total === 0 ? (
        <p className="ds-muted">아직 분류된 상담이 없습니다.</p>
      ) : null}
    </Surface>
  );
}

export function EvidenceCard({
  title,
  source,
  excerpt,
  detail,
}: {
  title: string;
  source: string;
  excerpt: string;
  detail: string;
}) {
  return (
    <Surface className="ds-evidence">
      <CardHeading
        title="판단의 근거"
        detail={<FileText size={19} aria-hidden="true" />}
      />
      <div className="ds-source-line">
        <StatusBadge tone="info">문서 예시</StatusBadge>
        <span>{source}</span>
      </div>
      <h4>{title}</h4>
      <blockquote>{excerpt}</blockquote>
      <details className="ds-disclosure">
        <summary>
          근거 맥락 펼치기
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="ds-detail-body">
          <p>{detail}</p>
          <p className="ds-muted">
            카드 표현을 위한 가상 문서입니다. 실제 법령이나 세무 자문이
            아닙니다.
          </p>
        </div>
      </details>
    </Surface>
  );
}

export function ExpertCard({
  name,
  specialty,
  topics,
}: {
  name: string;
  specialty: string;
  topics: string[];
}) {
  return (
    <Surface material="glass" className="ds-expert">
      <CardHeading
        title="함께하는 전문가"
        detail={<StatusBadge tone="success">상담 가능</StatusBadge>}
      />
      <div className="ds-person">
        <span className="ds-avatar" aria-hidden="true">
          {name.slice(0, 1)}
        </span>
        <div>
          <h4>
            {name}
            <span>세무사</span>
          </h4>
          <p>{specialty}</p>
        </div>
      </div>
      <div className="ds-tags">
        {topics.map((topic) => (
          <span key={topic}>{topic}</span>
        ))}
      </div>
      <p className="ds-muted ds-expert-note">
        복잡한 판단이 필요한 순간,
        <br />
        사람의 경험으로 이어집니다.
      </p>
      <details className="ds-disclosure">
        <summary>
          프로필 보기
          <ArrowUpRight size={16} aria-hidden="true" />
        </summary>
        <div className="ds-detail-body">
          <p>
            {name}은 디자인 검토용 가상 전문가입니다. 전문 분야와 상담 가능
            상태도 예시입니다.
          </p>
        </div>
      </details>
    </Surface>
  );
}

export function WorkflowCard({
  title,
  description,
  index,
  selected,
  state,
  onSelect,
}: {
  title: string;
  description: string;
  index: number;
  selected: boolean;
  state: "complete" | "active" | "waiting";
  onSelect: () => void;
}) {
  const Icon =
    state === "complete"
      ? Check
      : state === "active"
        ? MessageCircle
        : ShieldCheck;
  return (
    <button
      type="button"
      className="ds-workflow-card"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="ds-workflow-top">
        <span>단계 {index}</span>
        <StatusBadge
          tone={
            state === "complete"
              ? "success"
              : state === "active"
                ? "info"
                : "neutral"
          }
        >
          {state === "complete"
            ? "완료"
            : state === "active"
              ? "실행 중"
              : "대기"}
        </StatusBadge>
      </span>
      <span className="ds-workflow-title">
        <Icon size={20} aria-hidden="true" />
        <strong>{title}</strong>
      </span>
      <span className="ds-muted">{description}</span>
    </button>
  );
}

export type DataState = "ready" | "loading" | "empty" | "error";

export function DataStateCard({
  state,
  onRetry,
}: {
  state: DataState;
  onRetry: () => void;
}) {
  return (
    <Surface
      className="ds-state-card"
      aria-label="데이터 상태 예시"
      aria-busy={state === "loading"}
    >
      <CardHeading
        title="검토할 상담"
        detail={<span className="ds-muted">예시</span>}
      />
      {state === "ready" ? (
        <>
          <p className="ds-value">
            8<span>건</span>
          </p>
          <p className="ds-muted">전문가의 확인을 기다리고 있어요.</p>
        </>
      ) : null}
      {state === "loading" ? (
        <div role="status">
          <span className="ds-sr-only">상담을 불러오는 중</span>
          <div className="ds-skeleton ds-skeleton-number" />
          <div className="ds-skeleton ds-skeleton-line" />
          <p className="ds-muted">상담을 불러오는 중…</p>
        </div>
      ) : null}
      {state === "empty" ? (
        <div className="ds-state-message">
          <Search size={25} aria-hidden="true" />
          <h4>아직 검토할 상담이 없어요</h4>
          <p className="ds-muted">새 상담이 배정되면 여기에 표시됩니다.</p>
        </div>
      ) : null}
      {state === "error" ? (
        <div className="ds-state-message">
          <StatusBadge tone="danger">불러오기 실패</StatusBadge>
          <p>상담 목록을 불러오지 못했어요.</p>
          <Button className="ds-control" variant="outline" onClick={onRetry}>
            <RotateCcw size={15} />
            다시 불러오기
          </Button>
        </div>
      ) : null}
    </Surface>
  );
}
