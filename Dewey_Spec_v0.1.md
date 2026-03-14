# Dewey — Educational Leadership Coaching System
## Technical Specification v0.1

---

## Overview

Dewey is an AI-powered coaching system for educational leaders. The user interacts through a custom web interface. A local server handles conversation management, RAG retrieval, and prompt construction. Claude (via API) serves as the reasoning and coaching engine. Mistral 7B (via Ollama) handles lightweight local inference tasks.

This specification covers the proof-of-concept (v0.1) scope. Features marked **[FUTURE]** are explicitly out of scope for the initial build.

---

## System Architecture

### Two-Layer Design

**Layer 1 — Local Server (home Ubuntu mini-PC, RTX 3060)**
- Conversation routing and state management
- Arc and phase classification (Mistral 7B via Ollama)
- RAG retrieval (RAGDoll via semantic similarity)
- Prompt construction
- Response parsing and phase flag evaluation
- Session storage (conversation history, phase state)

**Layer 2 — Coaching Engine (Claude API)**
- Receives a fully constructed prompt from the local server
- Returns structured JSON: coaching response, RAG sources used, phase completion flag
- Has no direct access to RAGDoll, conversation history, or session state

### API Key
Claude API key stored in `.env.local`. Never committed to source control.

---

## Data Files

### coaching_phases.json
Defines the atomic conversation phase LEGOs. Each phase is reusable across multiple arcs.

**Fields per phase:**
- `machine_name` — snake_case identifier used by the local system (e.g., `root_cause_analysis`)
- `display_name` — human-readable label
- `objective` — what this phase is trying to accomplish
- `ending_criteria` — conditions under which this phase is considered complete
- `callback_invitation` — (nullable) closing language Claude uses at the end of a terminal phase to invite a future session

**Current phases:**
1. `current_state` — Clarify the problem and gap
2. `root_cause_analysis` — Surface and test root cause hypotheses
3. `conditions_for_success` — Define what solving the problem looks like
4. `planning` — Design a concrete response
5. `implementation` — Navigate what is happening during execution
6. `interrogate_results` — Examine outcomes and determine next loop (declare victory / refine plan / revisit root cause)
7. `assumption_interrogation` — Surface and test underlying mental models
8. `stakeholder_navigation` — Map stakeholder interests and develop influence strategy
9. `perspective_taking` — Build understanding of another person's point of view

Note: `interrogate_results` is a decision-point phase. When it completes, the local system routes to: (a) close session, (b) loop back to `planning`, or (c) loop back to `root_cause_analysis`. This routing logic lives in server code, not in the JSON.

---

### arcs.json
Defines canonical conversation sequences built from phase LEGOs.

**Fields per arc:**
- `machine_name` — snake_case identifier
- `display_name` — human-readable label
- `description` — what problem this arc is designed to address; used by Mistral for matching
- `phase_sequence` — ordered array of `machine_name` values
- `diagnostic_markers` — array of phrases/patterns that signal this arc is appropriate; used as semantic guidance for Mistral (not keyword matching)

**Current arcs:**

| Arc | Phase Sequence |
|-----|---------------|
| `problem_of_practice_fresh` | current_state → root_cause_analysis → conditions_for_success → planning |
| `problem_of_practice_planned` | conditions_for_success → planning |
| `problem_of_practice_implementing` | implementation → interrogate_results |
| `problem_of_practice_results` | interrogate_results |
| `interpersonal_conflict` | current_state → perspective_taking → assumption_interrogation → stakeholder_navigation → planning |
| `change_management` | current_state → conditions_for_success → stakeholder_navigation → planning |

Note: Arcs share phase LEGOs. `planning` is the same LEGO regardless of which arc it appears in. Arc definitions can be extended without modifying phase definitions.

---

## Workflow (v0.1 Scope)

### Step 1 — Receive first user prompt
User types an opening message in the web interface describing what they want to work on.

### Step 2 — Determine arc (Mistral via Ollama)
Pass the user's prompt plus all arc descriptions and diagnostic markers to Mistral. Mistral returns one of:
- The `machine_name` of the matched arc (high confidence)
- A single clarifying question (low confidence)

If Mistral returns a clarifying question, display it to the user, collect response, and retry arc matching with the enriched input.

If no arc matches with reasonable confidence, Mistral may compose an ad-hoc arc from available phase LEGOs. **[FUTURE: log ad-hoc arcs for review and potential promotion to canonical arcs]**

Once arc is determined, local system loads the phase sequence from `arcs.json` and sets current phase to phase_sequence[0].

**Note:** Mistral returns only the arc name. The local system resolves the phase sequence independently.

### Step 3 — Gather relevant RAG
Query RAGDoll using semantic similarity against the current phase `machine_name` and the user's prompt. Retrieve the top N chunks above the similarity threshold. Number each chunk (1, 2, 3...) for reference in the Claude prompt. Strip document links from chunks before sending to Claude (links are stored locally for display).

### Step 4 — [FUTURE] Gather prior conversation summaries
Semantic similarity search against saved conversation conclusion summaries. Inject relevant summaries into prompt. Out of scope for v0.1.

### Step 5 — Construct prompt to Claude
Build a structured prompt containing:

**System message:**
```
You are an executive coach for educational leaders. Your role is to guide leaders through structured conversations using the Socratic method — asking questions, surfacing assumptions, and helping leaders think more clearly rather than providing answers. Be warm, direct, and curious. Do not moralize.

You are currently in the following conversation phase:
Phase: {display_name}
Objective: {objective}
This phase is complete when: {ending_criteria}

Return your response as JSON in the following format:
{
  "response": "your coaching response here",
  "rag_sources_used": [1, 3],
  "phase_complete": true or false,
  "phase_complete_reasoning": "brief explanation"
}
```

**Prompt body:**
- Numbered RAG chunks (text only, no links): `[1] {chunk_text}` ...
- Current conversation transcript (full for v0.1; summarized when context limits are approached — [FUTURE])
- Current user message

### Step 6 — Send to Claude API
POST to Claude API using key from `.env.local`. Use `claude-sonnet-4-6` model. Handle errors and timeouts gracefully.

### Step 7 — Claude returns structured JSON
Response includes:
- `response` — coaching prose to display to user
- `rag_sources_used` — array of chunk numbers Claude cited
- `phase_complete` — boolean
- `phase_complete_reasoning` — brief explanation of why phase is or is not complete

### Step 8 — Local system processes response
- Display `response` to user
- Populate RAG document links for the chunks listed in `rag_sources_used` (link display logic already implemented)
- Evaluate `phase_complete`:
  - If `false`: continue in current phase, proceed to Step 9
  - If `true` and next phase exists in sequence: advance `current_phase` to next phase in arc, proceed to Step 9
  - If `true` and current phase is terminal: display `callback_invitation` from phase definition, print `FINISHED`, end session

**v0.1 behavior:** On session end, print `FINISHED`. No conversation conclusion saving, no summary generation, no prior conversation retrieval. These are deferred to a future build.

### Step 9 — Get next user prompt
Display input field. User types next message.

### Step 10 — Return to Step 3
Arc and phase are already set. Resume from RAG retrieval with updated conversation history and current phase.

---

## Claude Prompt Contract

Claude always receives:
1. System message with phase definition and JSON response schema
2. Numbered RAG chunks
3. Current conversation transcript
4. User's current message

Claude never receives:
- Raw RAGDoll document links
- Session metadata
- Arc or phase routing logic
- Prior conversation summaries (v0.1)

Claude always returns valid JSON matching the schema above. Malformed responses should be caught and retried once before surfacing an error to the user.

---

## Cost Notes

Token usage per turn is approximately:
- System message + phase definition: ~300–500 tokens
- RAG chunks (top N): ~1,000–3,000 tokens depending on N
- Conversation transcript: grows with session length; summarize if approaching context limits
- User message: ~50–200 tokens

At typical usage (5–10 turns per session, a few sessions per week per leader), API costs are expected to be modest (single-digit dollars per leader per month). Summarizing conversation history before injection is the primary cost control lever.

---

## Future Scope (Explicitly Deferred)

- **Step 4:** Semantic similarity search against prior conversation summaries
- **Conversation conclusions:** Structured saving of session outcomes (Topic, Date, Tags, Conclusion, Reasoning, Open Threads)
- **Personal RAGDoll library:** Tracking which sources were most useful per leader
- **Conversation fingerprinting:** Tagging sessions by topic/issue type for pattern analysis
- **Session continuity UI:** "Continue a prior conversation" flow on app open
- **History summarization:** Compress transcript when approaching context window limits
- **Ad-hoc arc logging:** Capture Mistral-composed arcs for potential promotion to canonical arcs
- **Audit trail:** Log phase transitions, timing, and coaching quality signals

---

*Dewey Spec v0.1 — drafted via design conversation, March 2026*
