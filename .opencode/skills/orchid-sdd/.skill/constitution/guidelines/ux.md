# UX guidelines

Intent: let every user complete the journey, understand what happened, and recover from failure.

## Required

- Design the empty, loading, partial, error, and recovery states, not only the happy path.
- Give every interactive element an accessible name, a visible focus state, and a keyboard path.
- Keep focus order and focus return predictable, especially in dialogs and after navigation.
- Never use colour as the only carrier of meaning; pair it with text, shape, or an icon.
- Error copy states what happened, what the user can do next, and whether data was saved. It never blames the user.
- Destructive actions require confirmation and a way back or undo.
- Respect reduced motion and the smallest supported viewport and input method.
- Use the product glossary; do not invent a second name for an existing concept.
- Test the journey with a keyboard and a screen reader or an equivalent accessibility check.

## Anti-patterns

- A success screen with no empty, error, or recovery design.
- Placeholder copy shipped to production.
- A custom control that reimplements native behaviour without its accessibility.
- A modal with no focus trap, escape path, or focus return.
- "Something went wrong" with no next action.
- Hiding a flow gap behind visual polish.

## Evidence

- State inventory for the journey: empty, loading, partial, error, recovery.
- Keyboard and accessibility walkthrough notes.
- Copy deck or final strings with the recovery action.
- Confirmation/undo evidence for destructive actions.

## Exceptions

A user-facing gap may be accepted by the PM or human owner with the affected users and residual risk recorded. Accessibility is not waived by visual preference.
