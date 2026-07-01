#!/usr/bin/env python3
"""
병의원 원장 비용처리 판단 엔진 — Clinic Expense Decision Engine
================================================================
"이 지출을 비용처리할 수 있나?"를 사전 확인정보(intake) 기반으로 판별한다.

핵심 설계 원칙 (케이스 데이터에서 도출):
  · 입증책임은 납세자에게 있다 → 정보·증빙 없으면 기본값 = 부인
    [조심 2025구1960: 필요경비 입증책임은 납세자, 증빙 미제출 시 부외경비 부인]
  · 업무관련성 = 전부 / 안분 / 부인 의 3단계
  · 업무용승용차·접대비·복리후생 등은 별도 특례·한도 규정 우선 적용

입력 스키마 (Part C/D에서 확정한 4종 입력군):
  1. 명의·계약    : 사업자 명의인가
  2. 사용 실태     : 누가·어디에·무엇에 썼나 (업무 vs 사적)
  3. 안분 측정값   : 업무사용비율 (운행기록·면적·일정·회선)
  4. 증빙          : 적격증빙 + 업무관련성 입증자료
  + 공통 전제      : 사업자유형 · 기장의무 · 성실신고대상
"""

from dataclasses import dataclass, field
from enum import Enum


# ── 공통 전제 (모든 문항의 관문) ───────────────────────────────────────────────

class BizType(Enum):
    개인의원 = "개인의원"      # 필요경비 (소득세법)
    의료법인 = "의료법인"      # 손금 (법인세법)


@dataclass
class ClinicProfile:
    biz_type: BizType = BizType.개인의원
    복식부기: bool = True              # 복식부기 의무자 여부
    성실신고확인대상: bool = False     # 업무용승용차 업무전용보험 의무 등에 영향


# ── 지출 항목 유형 ──────────────────────────────────────────────────────────────

class ExpenseType(Enum):
    업무용승용차 = "업무용승용차"      # Q1 리스, Q7 자가차량
    임차료 = "임차료"                  # Q2 오피스텔 휴게공간
    접대성지출 = "접대성지출"          # Q3 골프, Q4 명품제공(접대성)
    광고선전비 = "광고선전비"          # Q4 명품제공(불특정다수)
    통신비 = "통신비"                  # Q5 휴대폰
    복리후생비 = "복리후생비"          # Q6 헬스장
    출장비 = "출장비"                  # Q8 해외출장
    소프트웨어구독 = "소프트웨어구독"  # Q9 AI 구독
    가사관련비 = "가사관련비"          # Q10 자택 사무공간


# ── 입력: 개별 지출 ─────────────────────────────────────────────────────────────

@dataclass
class ExpenseInput:
    etype: ExpenseType
    amount: int                          # 지출 금액(연액)
    in_business_name: bool = True        # 사업자 명의 지출 여부
    has_qualified_receipt: bool = True   # 적격증빙(세금계산서·카드·현금영수증) 보유
    business_use_ratio: float = 1.0      # 업무사용비율 0.0~1.0 (입증가능한 값)

    # 항목별 추가 결정변수 (swing factors)
    # 차량
    운행기록부: bool = False
    업무전용보험: bool = False
    승용차특례대상: bool = True          # 경차/화물/9인승↑이면 False(특례 미적용=전액 가능)
    # 접대/광고
    상대방_거래처: bool = False          # 동반/수령자가 사업관련 거래처인가
    상대방_기록보유: bool = False        # 접대상대·목적 기록 보유
    인당금액: int = 0                    # 광고선전 vs 접대비 구분 (3만원 기준)
    불특정다수: bool = False             # 불특정 다수 대상(광고선전비 성격)
    # 복리후생
    전직원_수혜: bool = False            # 전 직원 대상인가 (원장 단독 아님)
    사규근거: bool = False               # 복리후생 사내규정 존재
    # 출장
    공식일정증빙: bool = False           # 학회·세미나 등록증 등
    동반가족: bool = False
    # 가사관련
    별도사업장등록: bool = False         # 자택과 분리된 사업장 별도 존재


# ── 출력 ────────────────────────────────────────────────────────────────────────

class Verdict(Enum):
    전부인정 = "전부 인정"
    안분인정 = "안분 인정"
    부인 = "부인"
    조건부 = "조건부 (증빙 보완 시 인정)"


@dataclass
class ExpenseResult:
    verdict: Verdict
    인정금액: int
    리스크점수: int                      # 0(안전)~100(고위험)
    근거: str
    필요증빙: list = field(default_factory=list)


# ── 공통 게이트: 명의·증빙 ──────────────────────────────────────────────────────

def _gate(e: ExpenseInput):
    """명의·적격증빙 결여 시 즉시 부인/조건부 반환. 통과 시 None."""
    if not e.has_qualified_receipt:
        return ExpenseResult(Verdict.조건부, 0, 80,
            "적격증빙(세금계산서·계산서·신용카드·현금영수증) 미보유 → 손금부인 + 증빙불비가산세(2%) 위험. "
            "[입증책임=납세자, 조심2025구1960]",
            ["적격증빙 수취·보관", "업무관련성 소명자료"])
    if not e.in_business_name:
        return ExpenseResult(Verdict.조건부, 0, 65,
            "사업자 명의 외 지출 → 업무관련성 입증 난이도 급상승. 명의·실사용 증빙 없으면 부인",
            ["사업용 계좌·카드 결제내역", "실제 업무사용 입증자료"])
    return None


def _ratio_result(e: ExpenseInput, base_reason: str, evidences: list):
    """업무사용비율에 따른 안분 판정 공통 처리."""
    r = e.business_use_ratio
    amt = int(e.amount * r)
    if r >= 0.999:
        return ExpenseResult(Verdict.전부인정, amt, 20, base_reason + " — 100% 업무사용 입증", evidences)
    if r <= 0.0:
        return ExpenseResult(Verdict.부인, 0, 90, base_reason + " — 업무사용 입증 0%", evidences)
    return ExpenseResult(Verdict.안분인정, amt, 50,
        base_reason + f" — 업무사용비율 {r:.0%} 안분(입증 가능한 범위만)", evidences)


# ── 항목별 규칙 ─────────────────────────────────────────────────────────────────

def rule_업무용승용차(p: ClinicProfile, e: ExpenseInput):
    ev = ["운행기록부(업무사용비율 입증)", "차량등록증(사업자 명의)", "업무전용자동차보험 가입증명"]
    if not e.승용차특례대상:
        return ExpenseResult(Verdict.전부인정, e.amount, 15,
            "경차·화물차·9인승↑ → 업무용승용차 특례 미적용, 업무관련 전액 가능", ev)
    # 성실신고/법인은 업무전용보험 미가입 시 전액 부인
    if (p.성실신고확인대상 or p.biz_type == BizType.의료법인) and not e.업무전용보험:
        return ExpenseResult(Verdict.부인, 0, 95,
            "성실신고대상·법인은 업무전용자동차보험 미가입 시 관련비용 전액 부인 [조특·법인세법 업무용승용차]", ev)
    if not e.운행기록부:
        # 운행기록 없으면 연 1,500만원 한도 내 인정(가족 사용=사적사용분 부인 취지)
        cap = min(e.amount, 15_000_000)
        return ExpenseResult(Verdict.안분인정, cap, 60,
            "운행기록부 미작성 → 연 1,500만원 한도 내 인정. 주말 가족사용분은 사적사용으로 부인 대상", ev)
    return _ratio_result(e, "운행기록부상 업무사용비율로 안분 [업무용승용차 규정]", ev)


def rule_임차료(p: ClinicProfile, e: ExpenseInput):
    ev = ["임대차계약서(사업자 명의)", "실제 사용용도·사용자 입증(출입기록·비품·사진)", "병원과의 거리·동선 자료"]
    return _ratio_result(e,
        "휴게공간이 직원 복리후생·업무용으로 실사용되면 인정. 원장 개인 거주·사적사용은 부인", ev)


def rule_접대성지출(p: ClinicProfile, e: ExpenseInput):
    ev = ["접대 상대방·목적 기록", "거래처 관련성 입증", "접대비 연 한도 사용현황"]
    if not e.상대방_거래처 or not e.상대방_기록보유:
        return ExpenseResult(Verdict.부인, 0, 85,
            "동반자가 거래처가 아니거나 상대방·목적 기록 미보유 → 개인적 지출로 부인. "
            "[필요경비 입증책임=납세자, 조심2025구1960]", ev)
    return ExpenseResult(Verdict.조건부, e.amount, 55,
        "사업관련 접대로 인정 가능하나 접대비 손금산입 한도(기본+수입금액 비례) 내에서만 인정. 한도초과분 부인", ev)


def rule_광고선전비(p: ClinicProfile, e: ExpenseInput):
    ev = ["수령자·제공목적 기록", "불특정다수 대상 입증", "의료법상 환자유인 비해당 검토"]
    if e.불특정다수 and e.인당금액 <= 30_000:
        return ExpenseResult(Verdict.전부인정, e.amount, 30,
            "불특정 다수 대상 + 1인당 3만원 이하 → 광고선전비로 전액 인정", ev)
    if not e.불특정다수:
        return ExpenseResult(Verdict.조건부, e.amount, 70,
            "특정 고객 대상 고가 물품 제공 → 접대비로 분류(한도 적용) 또는 부인. "
            "의료법상 환자유인 금지 저촉 시 비용 부인 + 행정처분 리스크", ev)
    return ExpenseResult(Verdict.조건부, e.amount, 50,
        "불특정다수이나 1인당 고액 → 접대비 성격 검토 필요", ev)


def rule_통신비(p: ClinicProfile, e: ExpenseInput):
    ev = ["회선별 명의·사용자", "업무용 회선 실사용 증빙"]
    return _ratio_result(e,
        "업무 전용 회선분만 인정. 2대 중 1대 사적사용이면 해당분 부인", ev)


def rule_복리후생비(p: ClinicProfile, e: ExpenseInput):
    ev = ["복리후생 사내규정", "전 직원 이용 실태", "회원권 명의"]
    if e.전직원_수혜 and e.사규근거:
        return ExpenseResult(Verdict.전부인정, e.amount, 35,
            "전 직원 대상 + 사내 복리후생 규정 근거 → 복리후생비 인정", ev)
    return ExpenseResult(Verdict.부인, 0, 85,
        "원장 단독 수혜 또는 사규 부재 → 개인적 비용으로 부인 (원장 개인 운동은 업무무관)", ev)


def rule_출장비(p: ClinicProfile, e: ExpenseInput):
    ev = ["학회·세미나 등록증 등 공식일정 증빙", "전체 일정 중 업무일/관광일 구분", "항공·숙박·일정표"]
    if not e.공식일정증빙:
        return ExpenseResult(Verdict.부인, 0, 85,
            "업무목적(학회·세미나 등) 공식 증빙 미보유 → 개인 여행으로 부인", ev)
    if e.동반가족:
        return ExpenseResult(Verdict.안분인정, int(e.amount * e.business_use_ratio), 60,
            "동반가족 비용은 부인, 원장 본인의 업무일 해당분만 안분 인정", ev)
    return _ratio_result(e, "업무일/관광일 비율로 안분. 순수 관광일분은 부인", ev)


def rule_소프트웨어구독(p: ClinicProfile, e: ExpenseInput):
    ev = ["결제 명의(사업용)", "업무사용 입증(이용내역·산출물)"]
    return _ratio_result(e,
        "진료·병원운영에 실제 사용된 부분만 인정. 개인적 사용분은 부인", ev)


def rule_가사관련비(p: ClinicProfile, e: ExpenseInput):
    ev = ["자택 총면적 대비 업무사용 면적·비율", "업무수행 증빙", "관리비 청구내역·안분근거"]
    if e.별도사업장등록:
        return ExpenseResult(Verdict.부인, 0, 80,
            "별도 사업장이 존재 → 자택 행정공간 비용은 업무관련성 약함, 원칙적 부인", ev)
    return _ratio_result(e,
        "자택 중 업무전용 면적 비율로 안분. 가사관련경비는 엄격 입증 필요(소득세법 §33 가사경비 손금불산입)", ev)


RULES = {
    ExpenseType.업무용승용차: rule_업무용승용차,
    ExpenseType.임차료: rule_임차료,
    ExpenseType.접대성지출: rule_접대성지출,
    ExpenseType.광고선전비: rule_광고선전비,
    ExpenseType.통신비: rule_통신비,
    ExpenseType.복리후생비: rule_복리후생비,
    ExpenseType.출장비: rule_출장비,
    ExpenseType.소프트웨어구독: rule_소프트웨어구독,
    ExpenseType.가사관련비: rule_가사관련비,
}


def evaluate(p: ClinicProfile, e: ExpenseInput) -> ExpenseResult:
    gate = _gate(e)
    if gate:
        return gate
    return RULES[e.etype](p, e)


# ── 데모: 10개 질문 시나리오 ────────────────────────────────────────────────────

DEMO = [
    ("Q1 리스차량(주말 가족사용)", ExpenseInput(ExpenseType.업무용승용차, 18_000_000,
        운행기록부=True, 업무전용보험=True, business_use_ratio=0.7)),
    ("Q2 오피스텔 휴게공간", ExpenseInput(ExpenseType.임차료, 12_000_000, business_use_ratio=1.0)),
    ("Q3 골프(거래처 미동반)", ExpenseInput(ExpenseType.접대성지출, 3_000_000,
        상대방_거래처=False, 상대방_기록보유=False)),
    ("Q4 명품 고객제공(특정고객)", ExpenseInput(ExpenseType.광고선전비, 5_000_000,
        불특정다수=False, 인당금액=1_000_000)),
    ("Q5 휴대폰 2대(1대만 업무)", ExpenseInput(ExpenseType.통신비, 1_200_000, business_use_ratio=0.5)),
    ("Q6 헬스장(원장 단독)", ExpenseInput(ExpenseType.복리후생비, 1_500_000,
        전직원_수혜=False, 사규근거=False)),
    ("Q7 개인차량 출퇴근겸업무(기록無)", ExpenseInput(ExpenseType.업무용승용차, 10_000_000,
        운행기록부=False, 업무전용보험=True)),
    ("Q8 해외출장(관광 포함)", ExpenseInput(ExpenseType.출장비, 8_000_000,
        공식일정증빙=True, 동반가족=False, business_use_ratio=0.6)),
    ("Q9 AI 구독료(개인사용)", ExpenseInput(ExpenseType.소프트웨어구독, 600_000, business_use_ratio=0.0)),
    ("Q10 자택 행정공간", ExpenseInput(ExpenseType.가사관련비, 2_400_000,
        별도사업장등록=False, business_use_ratio=0.2)),
]


if __name__ == "__main__":
    profile = ClinicProfile(biz_type=BizType.개인의원, 복식부기=True, 성실신고확인대상=True)
    print(f"\n{'='*72}\n  병의원 비용처리 판단 — {profile.biz_type.value} / 성실신고대상={profile.성실신고확인대상}\n{'='*72}")
    for title, e in DEMO:
        r = evaluate(profile, e)
        print(f"\n▶ {title}")
        print(f"   판정: {r.verdict.value}  |  인정 {r.인정금액:,}/{e.amount:,}원  |  리스크 {r.리스크점수}/100")
        print(f"   근거: {r.근거}")
        print(f"   필요증빙: {' · '.join(r.필요증빙)}")
