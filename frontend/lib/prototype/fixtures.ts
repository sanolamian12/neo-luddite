import vehicle from "@/data/conversations/clinic-vehicle.json";
import golf from "@/data/conversations/clinic-golf.json";
import gym from "@/data/conversations/clinic-gym.json";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

/** Bundled examples only. No production data or account credentials. */
export function createFixtures(now = Date.now()): Tables {
  const experts = Array.from({ length: 9 }, (_, index) => ({
    auditor_id: index === 0 ? "auditor" : index < 3 ? `auditor${index + 1}` : `expert-${index + 1}`,
    listed: true,
    bio: ["병의원 비용처리와 소득세 상담을 돕습니다.", "온라인 사업자의 부가가치세 상담을 돕습니다.", "법인 운영과 회계 상담을 돕습니다."][index % 3],
    specialties: [["소득세", "병의원"], ["부가가치세", "온라인 셀러"], ["법인세", "회계"]][index % 3],
    years_experience: 3 + index,
    availability: ["available", "busy", "offline"][index % 3],
    avatar_url: null,
    avatar_color: ["#2c6e63", "#446b9e", "#a26f3e"][index % 3],
    contact_phone: null, phone_visibility: "hidden",
    contact_email: `expert${index + 1}@example.com`, email_visibility: "public",
    contact_kakao: null, kakao_visibility: "hidden",
    updated_at: now,
  }));
  const conversations = Object.entries({ "clinic-vehicle": vehicle, "clinic-golf": golf, "clinic-gym": gym }).map(([id, payload], index) => ({
    id, occupation: "clinic", tax_category: payload.topic.taxCategory,
    title: payload.topic.title, owner_id: "viewer", owner_label: "샘플 사장님",
    source: "prototype", status: "active", turn_count: payload.messages.filter((m) => m.role === "user").length,
    created_at: now - (index + 1) * 3_600_000, updated_at: now,
    snapshot_at: now, excluded_at: null, payload: { ...payload, id }, snapshot_payload: { ...payload, id },
  }));
  return {
    auditors: experts.map((expert, index) => ({
      id: expert.auditor_id, display_name: `샘플 세무사 ${index + 1}`,
      email: `expert${index + 1}@example.com`, phone: null, qualifications: ["세무사"],
      status: "active", created_at: now - 86_400_000, last_active_at: now, note: "프로토타입 샘플",
    })),
    expert_profiles: experts,
    expert_likes: [],
    conversations,
    audit_tasks: [{
      id: "task-prototype-1", label: "병의원 비용처리 검토", conversation_ids: ["clinic-vehicle", "clinic-golf"],
      capacity: 3, conditions: {}, deadline: now + 7 * 86_400_000, created_at: now,
      created_by: "admin", pickups: [], status: "open", note: "프로토타입 샘플 일감",
    }],
    consultation_requests: [{
      id: "consult-prototype-1", conversation_id: "clinic-gym", viewer_id: "viewer", expert_id: "auditor",
      message: "차량 비용처리 상담을 요청합니다. (샘플)", status: "pending", status_history: [], created_at: now, updated_at: now,
    }],
    consultation_offers: [], consultation_rooms: [], consultation_messages: [], room_agent_runs: [],
    conversation_pool_consents: [], conversation_pool_views: [],
    line_feedback: [], session_evaluations: [], audits: [], reviews: [],
    settlement_rounds: [], inquiries: [], ledger_entries: [],
    mail: [{
      id: "mail-prototype-1", recipient_id: "auditor", sender_id: "admin", kind: "notice",
      subject: "프로토타입에 오신 것을 환영합니다", body: "이 화면의 데이터와 변경 내용은 이 브라우저에만 저장됩니다.",
      ref: null, sent_at: now, read_at: null,
    }],
  };
}

export function createKnowledgeFixtures(now = Date.now()) {
  return {
    groups: [{ id: "group-prototype", label: "샘플 지식", status: "active", createdAt: now, updatedAt: now }],
    documents: [{ id: "doc-prototype", taxCategory: "소득세", title: "병의원 비용처리 (샘플)", status: "active", groupId: "group-prototype", createdAt: now, updatedAt: now }],
    sentences: [{
      id: "sentence-prototype", documentId: "doc-prototype", orderIndex: 0,
      content: "프로토타입용 샘플 문장입니다. 실제 세무 판단에 사용하지 마세요.",
      sourcePassageIds: ["passage-prototype"], attribution: [{ auditorId: "auditor", weight: 1 }],
      lockedByAuditor: false, lockedBy: null, effectivelyLocked: false,
      status: "active", version: 1, createdAt: now, updatedAt: now,
    }],
    passages: [{
      id: "passage-prototype", dedupeKey: "prototype", content: "병의원 상담의 출처 탐색을 위한 샘플 근거입니다.",
      sourceKind: "feedback", conversationId: "clinic-vehicle", auditorId: "auditor", reviewer: "샘플 세무사 1",
      taxCategory: "소득세", occupation: "clinic", feedbackTags: [], status: "active", createdAt: now, updatedAt: now,
    }],
  };
}
