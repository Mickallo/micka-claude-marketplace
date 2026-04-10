export interface ParsedOutput {
  content: string;
  decision_log: string;
  verdict: "ok" | "nok" | "relay";
}

export function parseAgentOutput(raw: string): ParsedOutput {
  const result: ParsedOutput = { content: "", decision_log: "", verdict: "ok" };

  // Try structured format: ## Content / ## Decision Log / ## Verdict
  const contentMatch = raw.match(/## Content\s*\n([\s\S]*?)(?=\n## Decision Log|\n## Verdict|$)/);
  const decisionMatch = raw.match(/## Decision Log\s*\n([\s\S]*?)(?=\n## Verdict|$)/);
  const verdictMatch = raw.match(/## Verdict\s*\n\s*(ok|nok|relay)/i);

  if (contentMatch) {
    result.content = contentMatch[1].trim();
  } else {
    // Fallback: everything is content
    result.content = raw.trim();
  }

  if (decisionMatch) {
    result.decision_log = decisionMatch[1].trim();
  }

  if (verdictMatch) {
    result.verdict = verdictMatch[1].toLowerCase() as "ok" | "nok" | "relay";
  } else {
    // Check last line for verdict
    const lines = raw.trim().split("\n");
    const lastLine = lines[lines.length - 1].trim().toLowerCase();
    if (lastLine === "ok" || lastLine === "nok" || lastLine === "relay") {
      result.verdict = lastLine as "ok" | "nok" | "relay";
    }
  }

  return result;
}
