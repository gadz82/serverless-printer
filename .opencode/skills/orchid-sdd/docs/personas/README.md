# Persona dossiers

This directory contains the detailed reference profile for every shipped persona.

orchid-sdd deliberately separates **active contracts** from **reference dossiers**:

- `.skill/personas/<ID>.md` is the active contract loaded when the persona participates.
  It stays concise so a persona does not consume context with role theater.
- `docs/personas/<ID>.md` is the detailed dossier. Read it when the role is active, when
  configuring a project persona, or when a finding needs a deeper rubric.

## Shipped personas

| Persona | Default | Primary phases | Authority | Dossier |
|---|---|---|---|---|
| **PM** (PO alias) | Yes | intent, discovery, logic_review | Blocking on business meaning | [PM](PM.md) |
| **DEV** | Yes | assessment, build | Advisory | [DEV](DEV.md) |
| **QE** | Yes | assessment, build, code_review | Blocking on test gaps | [QE](QE.md) |
| **TECH_LEAD** | No | intent, assessment, planning | Blocking on feasibility | [TECH_LEAD](TECH_LEAD.md) |
| **ARCHITECT** | No | assessment, code_review | Advisory | [ARCHITECT](ARCHITECT.md) |
| **DBA** | No | assessment, code_review | Blocking on data changes | [DBA](DBA.md) |
| **DEVOPS** | No | assessment, code_review | Blocking on infrastructure | [DEVOPS](DEVOPS.md) |
| **SECURITY** | No | assessment, code_review | Blocking on high findings | [SECURITY](SECURITY.md) |
| **UX** | No | discovery, logic_review | Advisory | [UX](UX.md) |

`PO` is not a separate persona. It resolves to **PM**.

## How to use a dossier

1. Use the active contract for phase participation and non-negotiables.
2. Read the dossier when the persona is cast, tagged, or routed to a review.
3. Cite the exact scope, evidence, and rubric in findings.
4. Keep project-specific edits in `.orchid/personas/`; never edit the skill package.
5. If a project persona overrides an ID, keep the same mission and authority unless the
   override explicitly changes them.

## Authoring rules

- A persona is a **role contract**, not a chatbot costume.
- Active bodies stay compact: mission, ownership, decision rights, phase obligations,
  evidence, handoff, and a link to the dossier.
- Dossiers may be detailed: questions, rubrics, anti-patterns, examples, and success
  measures.
- Every blocking finding needs a constitution/spec citation, evidence, and a remediation
  path.
- Nothing in a dossier overrides the constitution, an ADR, or an explicit human decision.
- Personas do not silently expand scope; they surface conflicts and hand them to the
  orchestrator.

Use [`_template.md`](_template.md) to add a project-specific dossier without changing the
skill defaults.
