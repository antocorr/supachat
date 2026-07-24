export function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.filter(p => p.trim());
}

export function chunkForKokoro(text: string, maxChars = 400): string[] {
  const chunks: string[] = [];
  for (const sentence of splitSentences(text)) {
    if (sentence.length <= maxChars) {
      chunks.push(sentence);
      continue;
    }
    let current = '';
    for (const clause of sentence.split(/(?<=[,;])\s+/)) {
      const candidate = current ? `${current} ${clause}` : clause;
      if (candidate.length <= maxChars) {
        current = candidate;
        continue;
      }
      if (current) chunks.push(current);
      if (clause.length <= maxChars) {
        current = clause;
      } else {
        for (let i = 0; i < clause.length; i += maxChars) chunks.push(clause.slice(i, i + maxChars));
        current = '';
      }
    }
    if (current) chunks.push(current);
  }
  return chunks.filter(c => c.trim());
}
