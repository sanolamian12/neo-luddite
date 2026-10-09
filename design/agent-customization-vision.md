# Agent customization vision

This document captures the evolving product vision for agent customization. It will grow as further context is shared. Stated direction, working interpretations, and open questions are kept separate.

The first implementation is specified in the [PRD](agent-customization-prd.md) and [user flows](agent-customization-flows.md). The open questions below preserve the original discussion; the PRD records the first-pass choices made under the user's delegation.

## Stated direction

### Experts evolve from hands-on workers to AI overseers

The vision is for experts to shift from performing the work directly to setting the policies, exclusions, and rules that govern AI work, and overseeing that work. Experts engage directly with clients only at critical moments when human engagement is needed.

The expert's role has three parts:

- **Set direction and boundaries:** Define the policies, exclusions, and rules under which AI operates.
- **Oversee AI work:** Maintain oversight of the work AI performs.
- **Engage at critical moments:** Step in when clients need human engagement.

### Client journey from the common model to an expert

1. **Start with the common model.** The client initially talks with the platform's common model, which is not customized by an individual expert.
2. **Receive an expert connection suggestion.** When the common model receives a signal that further discussion with an expert is needed, it suggests connecting with an expert.
3. **Choose an expert.** The client selects an expert from a list.
4. **Continue with the expert's customized agent in the same chat.** After selecting an expert, the existing chat switches to the agent customized by that expert. The expert also joins while the client continues consulting with the agent.
5. **Receive direct expert responses in the same chat.** At a later point, the selected expert becomes actively involved and speaks directly with the client within that chat.

The conversation remains continuous from the common AI through expert selection, the expert's customized agent and direct expert replies. Joining the chat and speaking directly are distinct moments. The technical mechanism for sharing that context and coordinating participants remains to be defined.

### Specialized interconnected LLMs

The intended model uses multiple interconnected LLMs, each responsible for a specific job.

**Fact collection agent.** The first LLM consults with the client to establish the factual base. Its dedicated RAG contains sets of questions for eliciting the necessary facts. Once the facts are collected, this agent consolidates them and passes them to the answer generation agent.

**Answer generation agent.** The second LLM receives the consolidated facts and generates an answer. It has its own dedicated RAG containing answer sets with three components: the factual base, judgment, and conclusion.

The stated information flow is: client consultation → fact collection guided by question sets → consolidated facts → answer generation supported by answer sets.

### Proposed agent for identifying human engagement needs

An agent scans the conversation with the client, predicts where human engagement is needed, and suggests that engagement. This role connects the AI workflow to the broader vision of experts stepping in at critical moments.

The proposal specifies detection and recommendation. The client journey establishes the flow from an expert connection suggestion to expert selection and a chat with the expert's customized agent. Whether this proposed agent supplies the common model's signal, monitors the expert chat, or serves both contexts remains undefined.

### Customization includes RAG and expert know-how

The customization scope includes both LLM configuration and the ability for experts to tune the RAG itself. The exact controls for RAG customization remain to be defined.

Experts should be able to convey their professional know-how to the agent. A guided teaching flow built around cases is an agreed direction for facilitating that transfer.

### Teach my agent

The agreed concept is to let experts teach through cases, review the resulting guidance, and test it on variations:

1. **Describe a case.** Supply the factual situation and the answer the expert would give.
2. **Explain the judgment.** Identify the decisive facts, questions to ask, exceptions, and what would change the conclusion or require human involvement. A useful prompt is: "What would make you answer differently?"
3. **Review the proposed guidance.** The system drafts a reusable case entry, questions, and applicable rules. The expert can correct their meaning and scope before saving.
4. **Try another case.** Preview the agent's response to a variation and check whether the guidance produces the intended behavior.

This follows the factual base → judgment → conclusion structure of the answer sets. The visual direction to explore is showing the expert's explanation become connected, editable pieces of guidance. The teaching concept is agreed; the detailed layout, exact RAG controls, and mechanism for applying saved guidance remain open.

### Customization experience

The agent customization flow should be very user-friendly and visual, with a slightly futuristic feel. It should avoid an overly technical appearance. These qualities set the experience direction; a specific layout or visual treatment has not yet been chosen in this vision discussion.

### Learning from human consultations and contributing together

The product direction includes teaching through existing chat consultations, lessons written from scratch, and recorded consultation sessions. Imported call transcripts are an existing prototype input; recording and transcription remain future capabilities. The current demo shows all three method options and exercises only the existing-chat path, pulling either a whole session or selected messages. The system organizes those source excerpts into proposed lessons; the expert confirms facts, adds the reasoning that was not spoken, defines applicability and exceptions, and checks a contrasting case before applying reusable knowledge.

Experts collectively improve the service. Personal teaching and contributing to the common KB are separate explicit actions. Contributions need attributable authorship, review feedback, revision history, publication lineage, and records that support future rewards. A submission does not by itself establish quality or earn payment. The reward policy, validated impact measurement and production settlement remain open.

The implementation contract and backend boundary are recorded in [session learning and contributions](session-learning-contributions.md).

### Three act demonstration and contribution credits

The demonstration follows one consultation across the customer, expert and administrator views. After the expert teaches their own agent, they selectively share knowledge with the common service. An administrator checks accumulated expert submissions, bundles selected contributions into a batch, and incorporates the batch into a RAG update. Expert contributions are accounted for, tracked and credited. The unit, value and settlement of those credits remain open.

The [three act demo brief](three-act-demo.md) records the agreed story and Korean dialogue. The [UI readiness audit](demo-ui-audit.md) maps its scenes to screens and implementation evidence, and the [demo mode implementation plan](demo-mode-plan.md) records the stateful run and reused surfaces. After agreeing to the plan, the user authorized implementation; `/demo` now connects the three acts with isolated browser-local state.

## Agreed priorities

The initial gap review identified six areas to resolve: the two client transitions, customization scope, human engagement criteria, coordination between AI and the expert in chat, continuity and correction of facts, and ongoing oversight. The agreed first priorities are:

1. **Clarify the two transitions.** Distinguish entering an expert's service through their customized agent from requesting the expert's direct human participation. Define the trigger and the promise to the client for each transition.
2. **Define the scope of customization.** LLM configuration and RAG customization are both in scope. Establish the specific controls and what the platform provides or controls, including responsibility for the question and answer collections. Questions asked, knowledge sources, judgment criteria, communication style, policies, exclusions, and engagement triggers are candidate areas to resolve. Use the agreed teaching flow to support the transfer of expert know-how.

These are priorities for further definition. Specific triggers, controls, and operating rules remain open.

## Working interpretation

Agent customization is a way for experts to express how AI should work under their oversight. This suggests that configuring AI behavior, overseeing its work, and deciding when to engage a human are connected parts of the product. This interpretation remains subject to the rest of the vision.

The two dedicated RAGs serve different purposes: question sets guide fact collection, while answer sets support judgment and conclusions based on the collected facts. The human engagement role observes the conversation; its exact connection to the other agents remains to be defined.

The client journey suggests two layers of service: a shared entry point through the common model, followed by an expert-specific chat where the customized agent and the human expert can both respond. The assignment of specialized LLMs and RAGs to these layers remains open.

A possible interface direction is to let experts shape their AI through familiar professional concepts: what it asks, how it answers, the rules it follows, and when it brings in a human. Plain language and visual relationships could make the connected agents understandable. These are working design interpretations, not agreed interface decisions.

## Open questions

To revisit as more context is shared:

- What triggers entry into an expert's service, and what separately triggers direct human participation? What is the client promised at each transition?
- What constitutes a critical moment requiring human engagement? How should the system respond to different reasons, such as missing knowledge, an excluded case, a sensitive judgment, or an explicit client request for a person? These are possible criteria, not agreed rules.
- How do experts oversee AI work in practice: what do they review, what draws their attention, how do they correct mistakes, and how do they check the effect of changes?
- What should policies, exclusions, and rules each cover?
- How do the expert and AI coordinate in the same chat: who responds, when does the AI pause or resume, how is the speaker identified, and what happens when the expert is unavailable?
- The vision mentions three LLMs already established, then proposes another agent for human engagement. Is that proposal the third LLM's intended role, or an additional agent alongside three existing LLMs?
- When is the factual base complete enough to pass to the answer generation agent?
- How does answer generation return to fact collection when a fact is missing or contradictory, and how do client corrections affect an answer?
- When does the human engagement agent inspect the conversation, and does it operate in the common chat, the expert chat, or both?
- Which specialized LLMs and RAGs are shared across the platform, and which are customized by each expert?
- Does RAG customization primarily mean shaping knowledge, question sets, and case examples, or also controlling retrieval behavior? How does the expert's guidance become a change to the relevant agent or RAG collection?
- How is the existing conversation context made available to the selected expert and their agent while preserving the same customer chat?
- What does a contribution credit represent, and when is it awarded, reversed or settled after a batch RAG update?

## Progress record

- 2026-10-07: Implemented the agreed demo mode following the user's instruction to continue. Connected the same customer/expert chat, whole-session/excerpt teaching, separate sharing, admin review and batch incorporation, author credits and common-AI attribution. Added presenter controls and isolated run persistence; verified the complete local sequence on development and production builds. Recording remains a visible planned option.
- 2026-10-07: User narrowed Act 2 to one demonstrated teaching method while showing all three options. Pull the existing Act 1 chat, whole or in part, then review and apply one lesson. Updated the story, UI audit and implementation plan: add source-message selection and traceability; retain manual writing and show recording as an option without implementing capture/transcription for this demo. A prepared private lesson supports the selective-sharing comparison.
- 2026-10-06: User agreed to the three-act story and requested its documentation, a complete UI inventory and a demo-mode implementation plan. Exercised the existing rehearsal → human reply → teaching → shared submission → individual admin publication path. Recorded missing customer-thread continuity, recording intake, batch incorporation, connected credit and presenter controls. Proposed one isolated run on existing role screens.
- 2026-10-06: Captured the three-act demo: continuous common-AI to expert-agent chat, expert joining before direct intervention, three teaching methods including recording, selective sharing, administrator batch RAG updates and tracked expert credits. User requested a storyboard and gap analysis first; implementation remains a subsequent step.
- 2026-10-06: Agreed to teach from human consultation sessions and add a shared-KB contribution gateway. Confirmed that collective improvement, traceability and rewardable contributions are core product ideas.

- 2026-10-01: Captured the initial vision for the evolution of the expert's role.
- 2026-10-01: Added the specialized LLM model, the separate RAGs for fact collection and answer generation, and the proposed human engagement agent. Left agent count and monitoring timing open for clarification as the vision develops.
- 2026-10-01: Added the client journey from the common model through expert selection to a chat supporting the expert's customized agent and direct expert responses. Updated the open questions to reflect the clarified connection flow.
- 2026-10-01: Added the customization experience direction: very user-friendly, visual, slightly futuristic, and avoiding an overly technical appearance. Kept potential interface approaches separate as working interpretations.
- 2026-10-01: Recorded agreement with the six gaps identified in the initial review and the priority of clarifying the two client transitions and customization scope. Added the remaining questions without selecting solutions.
- 2026-10-01: Confirmed that customization includes RAG as well as LLM configuration, and captured the goal of conveying expert know-how. Recorded a proposed teaching flow separately from the user's stated direction; UI and RAG mechanisms remain open.
- 2026-10-01: Promoted the Teach my agent concept to agreed direction following user confirmation. Cases, explanations of judgment, expert review of proposed guidance, and testing on variations form the teaching flow. Detailed UI and RAG mechanisms remain open.
- 2026-10-01: User delegated the first product and UI pass, requested a PRD and flows followed by implementation, and authorized delivery on main without further questions. Implementation decisions are recorded separately in the PRD.
