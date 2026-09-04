/**
 * Resolves the rep's generate inputs into the shape the generate flow consumes.
 *
 * The panel can present either a single "context or a direction" field
 * (legacy / default) or a paste-first layout with separate context +
 * instruction fields. Both funnel through resolveGenerateInput():
 *
 *   - repInstruction : the steer/direction the rep gave ("follow up about X")
 *   - repInput       : the primary text handed to generation
 *   - pasteMode      : whether a pasted context body is present
 *
 * When only one field is filled, we decide whether it reads as an instruction
 * (starts with an action verb, or "tell/let X know") or as pasted context.
 */

const INSTRUCTION_LEADING_VERB =
  /^(?:write|draft|send|text|email|create|make|remind|ask|follow[\s-]?up|tell|let)\b/i;

function looksLikeInstruction(value: string): boolean {
  const t = String(value || '').trim();
  return (
    !!t &&
    (INSTRUCTION_LEADING_VERB.test(t) ||
      /\b(?:follow[\s-]?up to|let(?:ting)?\s+(?:him|her|them|[A-Z][a-z]+)\s+know|tell\s+(?:him|her|them|[A-Z][a-z]+))\b/i.test(t))
  );
}

function splitGenerateInput(
  context: string,
  instruction: string,
): { repInstruction: string; pasteContext: string } {
  const instr = String(instruction || '').trim();
  const ctx = String(context || '').trim();
  if (instr) return { repInstruction: instr, pasteContext: ctx };
  if (ctx && looksLikeInstruction(ctx)) return { repInstruction: ctx, pasteContext: '' };
  return { repInstruction: '', pasteContext: ctx };
}

export function resolveGenerateInput(
  context: string,
  instruction: string,
): { repInstruction: string; repInput: string; pasteMode: boolean } {
  const { repInstruction, pasteContext } = splitGenerateInput(context, instruction);
  return {
    repInstruction,
    repInput: repInstruction
      ? pasteContext
        ? `${repInstruction}\n\n${pasteContext}`
        : repInstruction
      : pasteContext,
    pasteMode: Boolean(pasteContext),
  };
}
