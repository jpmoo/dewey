# Mock prompts sent to models

This doc shows the **actual prompts** the app sends to Ollama and Claude. Variable or turn-specific parts are labeled in `[brackets]` so you can see what is substituted at runtime.

---

## 1. Arc classification (Ollama) — intro

**When:** User submits the intro (first message).  
**API:** `POST /api/chat/ollama/generate`  
**Body:** `{ ollamaUrl, model, prompt, stream: false }`

**Prompt template:**

```
You are classifying a school leader's dilemma into one or more of the following coaching arcs. Match the dilemma using only the description and diagnostic markers.

- If one arc clearly fits best, respond with only that arc's reply key (the exact snake_case value shown).
- If two or more arcs could fit and you're unsure, respond with those keys separated by commas (e.g. change_initiative, problem_of_practice_implementing). You MUST then add a new line starting with QUESTION: and a short clarifying question to help the user choose (e.g. QUESTION: Is the main challenge getting people to adopt the new program, or measuring whether it's working?).
- If no arc fits, respond with NONE.

ARCS:
[arcList — one block per arc from /api/coaching/arcs:]
- Description: [description]
  Diagnostic markers: [diagnostic_markers joined with "; "]
  Reply with this key if this arc fits: [name]

USER'S DILEMMA AND CONTEXT:
Dilemma: [user intro text]
Name: [userPreferredName]
Role: [userRole]
School/office: [userSchoolOrOffice]
Context: [userContext]

Reply with one key, or comma-separated keys plus a QUESTION: line when multiple arcs apply, or NONE.
```

**Example (abbreviated ARCS):**

```
You are classifying a school leader's dilemma into one or more of the following coaching arcs. ...

ARCS:
- Description: The leader has identified a gap or problem but has not yet explored why...
  Diagnostic markers: I have a problem I need to figure out; Something is not working...
  Reply with this key if this arc fits: problem_of_practice_fresh
- Description: The leader is planning or managing rollout of a new program...
  Diagnostic markers: I need to change how we do; We are rolling out a new program...
  Reply with this key if this arc fits: change_initiative
...

USER'S DILEMMA AND CONTEXT:
Dilemma: I want to help principals facilitate deeper teacher collaboration. We're rolling out a new PLC structure and there's confusion about what it should look like.
Name: Jeff
Role: Assistant Superintendent
School/office: [user's school]
Context: [user's context]

Reply with one key, or comma-separated keys plus a QUESTION: line when multiple arcs apply, or NONE.
```

**Expected response format:** One line with a single key (e.g. `change_initiative`) or comma-separated keys, optionally followed by a line `QUESTION: <clarifying question>`.

---

## 2. Clarification re-run (Ollama)

**When:** User submits a clarification after multiple arcs were returned.  
**API:** Same as above.  
**Difference:** The dilemma block uses the **enriched** text: `[lastDilemmaForClarification]\n\nClarification: [clarifyingInputValue]`. The instruction text is the same; the prompt asks for "one key, or comma-separated keys plus a QUESTION: line".

---

## 3. Compliance screening (Ollama) — before each coaching message

**When:** Before every user message in an active coaching session (after arc is chosen).  
**API:** `POST /api/chat/ollama/generate`  
**Body:** `{ ollamaUrl, model, prompt, stream: false }`

**Prompt:**

```
You are a compliance screening layer for a public K–12 educational leadership AI system operating in New Jersey.

Your task is to review the full conversation (including history) and determine whether the user is requesting or discussing content that may involve:
1. Specific identifiable student information ...
2. Specific identifiable personnel matters ...
...
Only flag if the conversation includes or is likely to elicit specific, identifiable, or confidential case-level information.

Output format:
Return ONLY one of the following:
ALLOW
or
BLOCK

--- Conversation to review ---

[Conversation so far as:]
User: [message 1]
Assistant: [message 2]
User: [message 3]
...
User: [current user message]
```

**Expected response:** Exactly `ALLOW` or `BLOCK`. If `BLOCK`, the app shows a compliance modal and does not send the message to Claude.

---

## 4. RAG query (optional) — per coaching turn

**When:** At the start of each coaching turn, if RAG is configured (ragUrl + ragCollections).  
**API:** `POST /api/chat/rag/query`  
**Body:** `{ ragUrl, prompt, group: ragCollections, threshold, limit_chunk_role: true }`

**Prompt sent as `prompt`:**  
`[phase display name] [current user message] [last assistant message trimmed to 120 chars]`  
e.g. `Current State I want to help principals facilitate deeper collaboration. We're rolling out a new PLC structure...`

Returned chunks are numbered and injected into the Claude user content (see below).

---

## 5. Coaching turn (Claude) — system + user

**When:** Each coaching turn (after compliance allows, RAG run if configured).  
**API:** `POST /api/chat/claude/generate`  
**Body:** `{ system: systemMessage, userContent }`

### System message template

```
You are an executive coach for educational leaders. Your role is to guide leaders through structured conversations using the Socratic method — asking questions, surfacing assumptions, and helping leaders think more clearly rather than providing answers. Be warm, direct, and curious. Do not moralize.

You are currently in the following conversation phase:
Phase: [displayName — e.g. Current State]
Objective: [objective — from phase definition]
This phase is complete when: [endingCriteria — from phase definition]

Return your response as JSON in the following format:
{
  "response": "your coaching response here",
  "rag_sources_used": [1, 3],
  "phase_complete": true or false,
  "phase_complete_reasoning": "brief explanation"
}
```

### User content template

```
[If user context fields set:]
User context (use when addressing the user):
Preferred name: [userPreferredName]
School or office: [userSchoolOrOffice]
Role: [userRole]
Context about school/office: [userContext]

[If RAG returned chunks:]
Relevant context (numbered chunks; cite by number in rag_sources_used):

[1] [chunk text]
[2] [chunk text]
...

Conversation so far:

User: [first user message]
Assistant: [first assistant message]
User: [second user message]
...

Current user message:

[current user message]
```

**Example (first turn, no RAG):**

System:
```
You are an executive coach for educational leaders. ...
Phase: Current State
Objective: Help the leader clearly articulate what is happening now, what outcomes they are seeing, and where the gap exists between current and desired results.
This phase is complete when: The leader can clearly describe the current situation, the gap they are experiencing, and the stakes involved. ...
Return your response as JSON ...
```

User content:
```
User context (use when addressing the user):
Preferred name: Jeff
School or office: Example District
Role: Assistant Superintendent
Context about school/office: Five schools; piloting new PLC structure.

Conversation so far:

(none)

Current user message:

I want to help principals facilitate deeper teacher collaboration. We're rolling out a new PLC structure and there's a lot of confusion about what it's supposed to look like.
```

**Expected response (JSON):** `response`, `rag_sources_used` (array of chunk numbers), `phase_complete` (boolean), `phase_complete_reasoning` (string). The app displays `response` and, if `phase_complete` is true, advances to the next phase or ends the session.

---

## Label reference

| [Bracket] | Meaning |
|-----------|--------|
| `[arcList]` | One line per arc: description, diagnostic_markers, reply key (from `/api/coaching/arcs`). |
| `[user intro text]` / `[current user message]` | Raw user message. |
| `[userPreferredName]`, `[userRole]`, etc. | From chat settings / "About you". |
| `[displayName]`, `[objective]`, `[endingCriteria]` | From current phase (e.g. `/api/coaching/phases`). |
| `[Conversation so far]` | Full transcript of the session so far (User: / Assistant: lines). |
| `[last assistant message]` | Used in RAG query and in transcript. |
