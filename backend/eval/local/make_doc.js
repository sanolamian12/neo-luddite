// 3차 평가 요청 Word — 안내 + 답변 원문. 사용: node make_doc.js <d3.jsonl> <out.docx>
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  HeadingLevel, AlignmentType, BorderStyle, LevelFormat, PageBreak,
} = require("docx");

const [, , src, out] = process.argv;
const rows = fs.readFileSync(src, "utf8").trim().split("\n").map(JSON.parse);
const by = {};
for (const r of rows) (by[r.scenario] = by[r.scenario] || []).push(r);
for (const k in by) by[k].sort((a, b) => a.turn - b.turn);

const FONT = "맑은 고딕";
const W = 9638; // A4 본문 폭(여백 2cm 양쪽) DXA
const GREY = "6B7280";
const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const borders = { top: border, bottom: border, left: border, right: border };

// **굵게** 를 TextRun 으로
function runs(text, opt = {}) {
  const out = [];
  text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (!part) return;
    const bold = part.startsWith("**") && part.endsWith("**");
    out.push(new TextRun({ text: bold ? part.slice(2, -2) : part, bold: bold || opt.bold, size: opt.size, color: opt.color, font: FONT }));
  });
  return out;
}
const P = (text, opt = {}) => new Paragraph({ children: runs(text, opt), spacing: { after: opt.after ?? 120, line: 300 }, alignment: opt.align });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, font: FONT })], spacing: { before: 240, after: 160 } });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, font: FONT })], spacing: { before: 240, after: 120 } });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: t, font: FONT })], spacing: { before: 160, after: 80 } });
const bullet = (t) => new Paragraph({ numbering: { reference: "dots", level: 0 }, children: runs(t), spacing: { after: 80, line: 300 } });
const number = (t) => new Paragraph({ numbering: { reference: "nums", level: 0 }, children: runs(t), spacing: { after: 80, line: 300 } });

function cell(text, w, opt = {}) {
  return new TableCell({
    borders, width: { size: w, type: WidthType.DXA },
    shading: opt.fill ? { fill: opt.fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: String(text).split("\n").map((ln) => new Paragraph({ children: runs(ln, { bold: opt.bold, size: opt.size ?? 19 }), alignment: opt.align })),
  });
}
function table(header, body, widths, opt = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, widths[i], { bold: true, fill: "E8EEF7" })) }),
      ...body.map((r) => new TableRow({ children: r.map((c, i) => cell(c, widths[i], { align: opt.alignRight?.includes(i) ? AlignmentType.RIGHT : undefined })) })),
    ],
  });
}

// Markdown 표 세그먼트 → Word 표
function mdTable(text) {
  const lines = text.split("\n").filter((l) => l.trim().startsWith("|"));
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  const head = cells(lines[0]);
  const sep = lines[1] || "";
  const right = cells(sep).map((c, i) => (/^-*:$/.test(c) ? i : -1)).filter((i) => i >= 0);
  const body = lines.slice(2).map(cells);
  const n = head.length;
  // 열 폭: 글자 수 비례(최소 1,000)
  const lens = head.map((h, i) => Math.max(h.length, ...body.map((r) => (r[i] || "").length)));
  const sum = lens.reduce((a, b) => a + Math.min(b, 60), 0);
  let widths = lens.map((l) => Math.max(1000, Math.round((Math.min(l, 60) / sum) * W)));
  const k = W / widths.reduce((a, b) => a + b, 0);
  widths = widths.map((w) => Math.floor(w * k));
  widths[n - 1] += W - widths.reduce((a, b) => a + b, 0);
  return table(head, body.map((r) => head.map((_, i) => r[i] || "")), widths, { alignRight: right });
}

function answerBlocks(r) {
  const out = [];
  for (const s of r.segments || []) {
    const t = s.t || "";
    if (t.trimStart().startsWith("|")) {
      out.push(mdTable(t));
      out.push(new Paragraph({ children: [], spacing: { after: 60 } }));
    } else {
      // 화면과 같게 '■ 머리:' 부분만 진하게(머리만 있는 줄은 전체)
      const m = t.startsWith("■") ? t.match(/^(■[^:：]{0,40}[:：])(.*)$/s) : null;
      const kids = m ? [...runs(m[1], { bold: true }), ...runs(m[2])] : runs(t, { bold: t.startsWith("■") });
      out.push(new Paragraph({ children: kids, spacing: { after: s.c.length ? 20 : 120, line: 300 } }));
    }
    if (s.c.length) out.push(new Paragraph({ children: [new TextRun({ text: "근거: " + s.c.join(" · "), size: 16, color: GREY, font: FONT })], spacing: { after: 120 } }));
  }
  if ((r.ui_blocks || []).includes("expert_handoff"))
    out.push(new Paragraph({
      children: [new TextRun({ text: "[화면] 답변 아래 ‘세무사 연결’ 박스가 함께 표시됨", size: 17, color: GREY, italics: true, font: FONT })],
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB", space: 4 } }, spacing: { before: 80, after: 160 },
    }));
  return out;
}

function quote(text) {
  return text.split("\n").filter((l) => l.trim()).map((ln) => new Paragraph({
    children: runs(ln), shading: { fill: "F3F4F6", type: ShadingType.CLEAR, color: "auto" },
    indent: { left: 200 }, spacing: { after: 40, line: 300 },
  }));
}

const SECTIONS = [
  ["X01", "질문1. 종합소득세율"], ["X02", "질문2. 연봉 5천만원 직장인의 세액"], ["X03", "질문3. 제조업 창업 — 간이과세"],
  ["X04", "질문4. 법인세 익금의 뜻"], ["X05", "질문1~4를 한 대화에서 이어서 물었을 때"],
  ["X06", "추가 질문1. 법인세율"], ["X07", "추가 질문2. 증여세 세율 구간"], ["W03", "추가 질문3. 연봉 7천만원 실수령액"],
];

const intro = [
  new Paragraph({ children: [new TextRun({ text: "네오러다이트 AI 답변 3차 평가 요청", bold: true, size: 36, font: FONT })], spacing: { after: 80 } }),
  P("지난 재평가(10월 12일 요청분) 결과를 반영한 답변 · 2026년 10월 15일", { color: GREY, after: 240 }),
  P("세무사님, 안녕하세요."),
  P("지난 재평가에서 4개 질문과 추가 질문까지 꼼꼼히 봐 주셔서 감사합니다. 특히 질문3이 오히려 퇴보했다는 지적과, 무관한 예규·판례를 가져온다는 지적을 중심으로 답변 구조를 고쳤습니다. 같은 질문으로 한 번 더 평가해 주시면 감사하겠습니다."),
  H1("1. 지난 평가 반영 내용"),
  table(["지난번 지적하신 점", "이번에 반영한 내용", "상태"], [
    ["질문3 퇴보 — 조문만 길게 나열하고 ‘제조업은 간이과세 배제 업종’이라는 핵심 결론을 놓침", "첫 문장을 질문에 대한 직답으로 바꿨습니다(제조업 = 부가가치세법 시행령 제109조제2항제2호 배제, 최종소비자 직접 공급 예외). 질문이 둘이면 나눠서 각각 답합니다.", "반영"],
    ["무관한 예규·판례를 매번 끌어옴(증여세율 답에 가업승계 특례 해석 등)", "법령으로 답이 되는 정의·세율 질문은 예규·판례를 넣지 않고, 요건 질문은 쟁점이 같은 1건까지만 씁니다. 현행 기준과 어긋난 옛 해석은 뺍니다.", "반영"],
    ["세율표·호 목록을 보여 준 뒤 같은 내용을 문장으로 반복", "표·번호 목록과 겹치는 문장을 지웁니다.", "반영"],
    ["단순 세율 질문에 ‘심판례·국세청 해석을 찾지 못했다’는 불필요한 문구", "법령만으로 끝나는 답에서는 이 문구를 쓰지 않습니다.", "반영"],
    ["질문4 익금 — 진입로까지만 안내", "법인세법 제15조 → 시행령 제11조(익금 범위) → 제18조(익금불산입)·제19조(손금)까지 이어서 설명하고, 끝에 관련 조문을 정리합니다.", "반영"],
    ["형식·가독성(계산은 산식, 비교는 표)", "계산은 단계별 산식 표, ‘차이’를 묻는 질문은 비교표, 긴 답은 맨 위에 한두 문장 결론을 먼저 보여 드립니다.", "반영"],
  ], [3300, 5338, 1000]),
  P(""),
  P("함께 바뀐 점: 한 대화에서 앞 질문과 세목이 다른 질문을 하시면, 앞 대화의 사정을 섞지 않고 새 질문으로 답한 뒤 ‘더 깊은 질문은 새 상담이나 세무사 상담을 권한다’는 안내와 세무사 연결 박스를 붙입니다(질문1~4를 한 대화에서 이어 물은 경우의 3·4번째 답).", { color: "374151" }),
  H1("2. 평가 방법"),
  number("이 문서 3장에 운영 중인 서비스(neo-luddite.vercel.app)에서 10월 15일에 받은 답변을 그대로 옮겼습니다. 표는 화면에서도 표로 보이고, 각 문장 아래 회색 ‘근거’는 화면의 출처 배지입니다."),
  number("직접 써 보셔도 됩니다. 같은 질문이라도 AI 문장은 회마다 조금씩 달라질 수 있습니다. 평가는 이 문서의 답변 기준으로 해 주시면 됩니다."),
  number("질문1~4는 따로 물었을 때와, 지난번처럼 한 대화에서 이어 물었을 때를 모두 실었습니다."),
  H1("3. 회신 방법"),
  bullet("함께 보내 드리는 엑셀 양식(02_네오AI_3차평가_점수양식.xlsx)의 ‘요약’ 시트에 문항별로 지난번 대비 개선 여부와 점수(정확성·답변 형식·근거 법령, 각 1~5점), 한 줄 의견을 적어 주세요. 지난번 점수는 참고로 옆 칸에 적어 두었습니다."),
  bullet("문장 단위로 짚어 주실 곳이 있으면 ‘문장별 의견’ 시트에 적어 주세요(선택)."),
  bullet("편하신 형식으로 주셔도 괜찮습니다."),
  H1("4. 참고"),
  bullet("AI 답변은 참고용입니다. 세액 계산은 말씀하지 않은 항목(비과세 급여, 4대보험 등)을 가정하고, 가정한 내용을 답변에 문장으로 밝힙니다."),
  bullet("세율·공제 금액은 2026년 시행 법령 원문을 기준으로 합니다."),
  P(""),
  P("바쁘신 중에 시간 내 주셔서 감사합니다."),
  P("네오러다이트 팀 드림", { align: AlignmentType.RIGHT }),
  new Paragraph({ children: [new PageBreak()] }),
  H1("5. 답변 원문"),
];

const body = [];
for (const [sid, title] of SECTIONS) {
  const rs = by[sid];
  if (!rs) continue;
  body.push(H2(title));
  for (const r of rs) {
    body.push(H3(rs.length > 1 ? `질문 (${r.turn}번째)` : "질문"));
    body.push(...quote(r.user));
    body.push(H3("네오러다이트 AI 답변"));
    body.push(...answerBlocks(r));
  }
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 28, bold: true, font: FONT, color: "1F3864" }, paragraph: { outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 25, bold: true, font: FONT, color: "1F3864" }, paragraph: { outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 21, bold: true, font: FONT, color: "374151" }, paragraph: { outlineLevel: 2 } },
    ],
  },
  numbering: { config: [
    { reference: "dots", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 260 } } } }] },
    { reference: "nums", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 300 } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    children: [...intro, ...body],
  }],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(out, b); console.log("written", out); });
