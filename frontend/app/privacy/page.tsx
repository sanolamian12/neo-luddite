import type { Metadata } from "next";
import { PublicHeader } from "@/components/layout/public-header";

export const metadata: Metadata = { title: "개인정보처리방침 | 네오러다이트" };

const EFFECTIVE_DATE = "2026년 10월 8일";
const OFFICER = { name: "정중은", email: "sanolamian12@gmail.com" };

/** 개인정보처리방침 — 공개 페이지(로그인 불필요). Google·카카오 OAuth 앱의 처리방침 URL 로도 쓴다. */
export default function PrivacyPage() {
  return <>
    <PublicHeader />
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-2xl font-semibold sm:text-3xl">개인정보처리방침</h1>
      <p className="mt-3 text-sm text-muted-foreground">시행일 {EFFECTIVE_DATE}</p>
      <p className="mt-6 leading-relaxed">
        네오러다이트(이하 &ldquo;운영자&rdquo;)는 세무 상담 서비스(이하 &ldquo;서비스&rdquo;)를 운영하면서 「개인정보 보호법」에 따라 이용자의
        개인정보를 보호하고 관련 고충을 원활하게 처리하기 위해 다음과 같이 개인정보처리방침을 둡니다.
      </p>

      <Section n={1} title="수집하는 개인정보 항목과 수집 방법">
        <Table head={["구분", "항목", "수집 방법"]} rows={[
          ["회원 가입·로그인 (Google·카카오)", "서비스 제공자가 발급하는 고유 식별값, 이름 또는 닉네임 / 선택: 이메일, 프로필 사진", "이용자가 동의한 범위에서 Google·카카오로부터 전달받음"],
          ["회원 가입·로그인 (이메일)", "이메일, 비밀번호(암호화하여 저장)", "운영자가 발급하는 운영·시연용 계정"],
          ["세무사 가입 신청", "이름, 세무사 등록번호, 사무소명과 소재지(시·구), 연락 이메일, 휴대폰 번호, 경력 연수, 전문 분야 / 선택: 소개", "Google·카카오로 가입한 회원이 신청서에 직접 입력 — 자격증 사본은 받지 않음"],
          ["서비스 이용 (회원)", "업종, 상담 질문과 대화 내용, 세무사 상담 신청 내용과 상담방 메시지", "이용자가 직접 입력"],
          ["서비스 이용 (비회원)", "상담 질문과 대화 내용", "이용자가 직접 입력 — 서버에 저장하지 않고 이용자의 브라우저에만 보관"],
          ["자동 수집", "접속 IP, 접속 일시, 요청 경로, 답변 처리 기록(업종·처리 결과 등, 질문 내용은 포함하지 않음)", "서비스 이용 과정에서 자동 생성"],
        ]} />
      </Section>

      <Section n={2} title="개인정보의 이용 목적">
        <List items={[
          "회원 식별, 로그인 유지, 부정 이용 방지",
          "세무 상담 답변 제공 — 입력한 질문과 이전 대화를 AI 처리에 사용합니다",
          "세무사 연결 — 이용자가 신청하거나 수락한 세무사와의 상담 진행",
          "세무사 가입 신청자의 자격 확인과 세무사 계정 부여 — 운영자가 등록번호와 이름으로 세무사 등록 여부를 직접 확인합니다",
          "답변 품질 검수와 지식베이스 구축 — 회원의 상담 대화는 운영자가 위촉한 세무사 검수자가 열람하여 답변의 정확성을 검토합니다. 검수를 마친 질문·답변·검수 의견은 이후 답변 품질을 높이기 위한 지식베이스에 반영될 수 있으며, 이때 이름·연락처·주소·사업자번호 등 식별 정보는 가린 뒤 반영합니다",
          "서비스 운영 현황 파악과 개선",
        ]} />
      </Section>

      <Section n={3} title="개인정보의 보유 기간과 파기">
        <List items={[
          "회원 정보와 회원의 상담 기록은 회원 탈퇴 즉시 파기합니다. 검수 기록, 세무사 상담 신청과 상담방 메시지, 지식베이스에 반영된 해당 회원의 질문도 함께 삭제합니다. 세무사 계정이면 세무사 카드, AI 상담 도우미 설정, 작성한 세무사 사례(공용 지식베이스에 공유된 사례 포함)도 함께 삭제합니다.",
          "세무사 가입 신청서는 반려되거나 철회되면 처리일로부터 30일 뒤 파기하고, 승인되면 세무사 계정을 유지하는 동안 보관합니다. 세무사 승인이 취소되면 취소일로부터 30일 뒤 파기합니다. 회원 탈퇴 시에는 즉시 파기합니다.",
          "세무사 승인이 취소되면 세무사 카드(소개·전문 분야·연락처)는 즉시 삭제하고 계정은 일반 회원으로 전환합니다. 이미 진행된 상담·검수·정산 기록은 상담 이력 확인과 정산을 위해 세무사의 이름과 함께 보존합니다.",
          "비회원의 대화는 서버에 저장하지 않으며, 이용자 브라우저의 저장 데이터를 지우면 함께 삭제됩니다.",
          "서버 접속 기록은 보안과 장애 대응을 위해 최대 3개월간 보관한 뒤 파기합니다.",
          "전자적 파일은 복구할 수 없는 방법으로 삭제합니다.",
        ]} />
      </Section>

      <Section n={4} title="개인정보의 제3자 제공">
        <p>운영자는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 이용자가 직접 요청한 다음의 경우에 한해 제공합니다.</p>
        <Table head={["제공받는 자", "제공 항목", "목적", "보유 기간"]} rows={[
          ["이용자가 상담을 신청하거나 수락한 세무사", "표시 이름, 해당 상담 대화 내용, 상담 신청 내용, 상담방 메시지", "세무 상담 진행", "상담 종료 또는 회원 탈퇴 시까지"],
          ["사례 공개에 동의한 경우 서비스에 등록된 세무사", "이름·연락처·주소 등 식별 정보를 가린 상담 대화 사본", "상담 제안", "동의 후 7일 또는 동의 철회 시까지"],
          ["서비스를 이용하는 회원 (세무사의 정보)", "세무사의 이름, 소개, 전문 분야, 경력, 세무사가 공개로 설정한 연락처", "세무사 카드 표시와 상담 연결", "세무사가 카드 노출을 끄거나, 탈퇴하거나, 세무사 승인이 취소될 때까지"],
        ]} />
      </Section>

      <Section n={5} title="개인정보 처리 위탁과 국외 이전">
        <p>운영자는 서비스 제공을 위해 다음 업체에 개인정보 처리를 위탁하며, 일부는 국외에서 처리됩니다. 개인정보는 서비스 이용 시점에 네트워크를 통해 전송됩니다.</p>
        <Table head={["수탁자", "위탁 업무", "처리 국가", "이전 항목"]} rows={[
          ["Supabase Inc.", "회원 인증, 데이터베이스 저장", "일본(도쿄)", "제1항의 회원 정보와 상담 기록 전체"],
          ["Oracle Corporation (Oracle Cloud)", "서비스 서버 운영", "일본(도쿄)", "상담 질문과 대화 내용, 접속 기록"],
          ["Vercel Inc.", "웹사이트 호스팅과 전송", "미국 등 전송 지역", "접속 기록"],
          ["(주)업스테이지", "AI 답변 생성과 검색", "대한민국", "상담 질문과 대화 내용"],
        ]} />
        <p>위탁 업무는 위탁 계약 종료 또는 회원 탈퇴 시까지 이루어지며, 국외 이전을 원하지 않는 이용자는 회원 탈퇴로 이전을 중단할 수 있습니다. 다만 이 경우 서비스를 이용할 수 없습니다.</p>
      </Section>

      <Section n={6} title="이용자의 권리와 행사 방법">
        <List items={[
          "이용자는 언제든지 자신의 개인정보 열람, 정정, 삭제, 처리 정지와 회원 탈퇴를 요청할 수 있습니다.",
          "회원 탈퇴는 로그인 후 계정 메뉴의 '회원 탈퇴'에서 직접 할 수 있으며, 즉시 처리됩니다.",
          `그 밖의 요청과 세무사·운영자 계정의 탈퇴는 아래 개인정보 보호책임자 이메일(${OFFICER.email})로 보내 주시면 본인 확인 후 지체 없이 처리합니다.`,
          "업종은 서비스 화면에서 직접 바꿀 수 있고, 사례 공개 동의는 언제든 철회할 수 있습니다.",
        ]} />
      </Section>

      <Section n={7} title="쿠키 등 자동 수집 장치">
        <p>운영자는 광고나 행동 분석을 위한 쿠키와 분석 도구를 사용하지 않습니다. 로그인 상태, 화면 설정, 비회원 대화는 이용자 브라우저의 저장 공간(로컬 스토리지 등)에 보관되며, 브라우저 설정에서 삭제할 수 있습니다. 삭제하면 로그아웃되고 비회원 대화가 사라집니다.</p>
      </Section>

      <Section n={8} title="개인정보의 안전성 확보 조치">
        <List items={[
          "모든 통신은 암호화(HTTPS)하여 전송합니다.",
          "비밀번호는 암호화하여 저장하며, 운영자도 원문을 알 수 없습니다.",
          "데이터베이스는 역할별 접근 권한으로 보호하여, 이용자는 본인의 정보만 조회할 수 있습니다.",
          "운영 권한은 승인된 관리자에게만 부여합니다.",
        ]} />
      </Section>

      <Section n={9} title="만 14세 미만 아동">
        <p>서비스는 사업자를 위한 세무 상담 서비스로, 만 14세 미만 아동의 회원 가입을 받지 않습니다.</p>
      </Section>

      <Section n={10} title="개인정보 보호책임자">
        <Table head={["구분", "내용"]} rows={[
          ["운영자", "네오러다이트"],
          ["개인정보 보호책임자", OFFICER.name],
          ["연락처", OFFICER.email],
        ]} />
      </Section>

      <Section n={11} title="권익 침해 구제 방법">
        <p>개인정보 침해에 대한 신고나 상담이 필요하면 아래 기관에 문의할 수 있습니다.</p>
        <List items={[
          "개인정보침해신고센터 (privacy.kisa.or.kr / 국번 없이 118)",
          "개인정보분쟁조정위원회 (www.kopico.go.kr / 1833-6972)",
          "대검찰청 사이버수사과 (www.spo.go.kr / 국번 없이 1301)",
          "경찰청 사이버수사국 (ecrm.police.go.kr / 국번 없이 182)",
        ]} />
      </Section>

      <Section n={12} title="개인정보처리방침의 변경">
        <p>이 방침은 {EFFECTIVE_DATE}부터 시행합니다. 내용이 바뀌면 시행 7일 전부터 이 페이지에 알립니다.</p>
      </Section>
    </main>
  </>;
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return <section className="mt-10 flex flex-col gap-3 leading-relaxed">
    <h2 className="text-lg font-semibold">{n}. {title}</h2>
    {children}
  </section>;
}

function List({ items }: { items: string[] }) {
  return <ul className="flex list-disc flex-col gap-1.5 pl-5">{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return <div className="overflow-x-auto rounded-md border">
    <table className="w-full min-w-[32rem] text-left text-sm">
      <thead className="bg-muted/50"><tr>{head.map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row[0]} className="border-t align-top">{row.map((cell, i) => <td key={i} className="px-3 py-2">{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}
