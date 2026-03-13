# Mock coaching queries (with turn/conversation labels)

Rundown of sample flows with turn- and conversation-specific info labeled in brackets. Use these to reason about arc/phase behavior and to test or demo the coaching engine.

---

## Example 1: Change Initiative (full arc)

**[arc]** `change_initiative`  
**[phase_sequence]** current_state → conditions_for_success → stakeholder_navigation → planning

---

### Turn 1

**[phase]** Current State  
**[user]**  
I'm interested in helping principals facilitate better collaboration between their teachers. We're rolling out a new PLC structure and there's a lot of confusion about what it's supposed to look like.

**[assistant]**  
[Coaching response clarifying current state: what’s happening now, what “confusion” looks like, gap between current and desired.]

**[phase_complete]** false → stay in Current State (or true → advance)

---

### Turn 2

**[phase]** Current State (if not complete) or Conditions for Success  
**[user]**  
Right now teachers are still planning in isolation. A few have started sharing in their PLCs but most say they don’t know what “good” looks like or how much time they’re supposed to spend.

**[assistant]**  
[Response continues current state or moves to conditions for success: what would “good” look like? How would you know collaboration was working?]

**[phase_complete]** true → advance to Conditions for Success

---

### Turn 3

**[phase]** Conditions for Success  
**[user]**  
I’d know we were there when PLCs have a shared agenda, bring student work to the table at least once a month, and principals can name what they’re seeing in the meetings.

**[assistant]**  
[Response sharpens conditions: concrete outcomes, non‑negotiables, one way they’d know they’d achieved it.]

**[phase_complete]** true → advance to Stakeholder Navigation

---

### Turn 4

**[phase]** Stakeholder Navigation  
**[user]**  
The main stakeholders are the principals, the lead teachers in each building, and the curriculum team. Some principals are on board; others think it’s another initiative that will go away.

**[assistant]**  
[Response explores who needs to be engaged, what each group needs to hear or experience, and how the leader will approach those conversations.]

**[phase_complete]** true → advance to Planning

---

### Turn 5

**[phase]** Planning  
**[user]**  
I’m thinking we start with principal 1:1s to get commitment, then a pilot in two buildings before we roll out the expectations and protocols to everyone.

**[assistant]**  
[Response helps design the plan: actions, sequence, stakeholders, resources, timeline. Ends with callback invitation to return once they’ve started implementing.]

**[phase_complete]** true → terminal phase; session can end with **[callback_invitation]** (e.g. “Come back once you have started implementing your plan…”)

---

## Example 2: Problem of Practice — starting fresh (intro + one phase)

**[arc]** `problem_of_practice_fresh`  
**[phase_sequence]** current_state → root_cause_analysis → conditions_for_success → planning

---

### Turn 1

**[phase]** Current State  
**[user]**  
I have a problem I need to figure out. Our middle school math scores have been flat for three years and we’re not sure where to start.

**[assistant]**  
[Response focuses on current state: what “flat” looks like, what’s been tried, where the gap is between current and desired.]

**[phase_complete]** false or true

---

### Turn 2 (if phase complete)

**[phase]** Root Cause Analysis  
**[user]**  
We’ve done curriculum alignment and added tutoring, but we haven’t really looked at whether instruction is consistent across teachers or how we’re using data.

**[assistant]**  
[Response surfaces hypotheses about why the gap exists and tests them; moves toward a root cause the leader is willing to act on.]

---

## Example 3: Clarification (multiple arcs)

**[classification]** Classifier returns more than one arc; user is asked to clarify.

**[arcs_returned]** e.g. `change_initiative`, `problem_of_practice_fresh`  
**[clarifying_question]** e.g. “Is this mainly about rolling out a new way of working (change initiative), or about solving a specific student-outcome or operational problem (problem of practice)?”

**[user]**  
It’s more about the rollout—getting people to actually use the new structure.

**[arc]** Resolved to `change_initiative`; conversation continues with **[phase]** Current State (or first phase in that arc’s sequence).

---

## Label reference

| Label | Meaning |
|-------|--------|
| **[arc]** | Coaching arc (e.g. `change_initiative`, `problem_of_practice_fresh`). |
| **[phase]** | Current phase display name for this turn (e.g. Current State, Root Cause Analysis). |
| **[phase_sequence]** | Ordered list of phases for the arc (machine names or display names). |
| **[phase_complete]** | Whether the model marked the phase complete this turn; if true, advance to next phase or end. |
| **[callback_invitation]** | Optional text shown when the terminal phase completes (invitation to return later). |
| **[user]** | User message (dilemma or reply). |
| **[assistant]** | Model coaching response. |
| **[classification]** / **[arcs_returned]** / **[clarifying_question]** | Intro flow: classifier output and optional clarification before an arc is chosen. |
