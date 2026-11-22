// The commit message standard, as one pure function. Used by the local commit-msg hook and by CI, so both
// enforce exactly the same rules. The standard itself is documented in CONTRIBUTING.md.

export const TYPES = ['feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'build', 'ci', 'chore', 'revert'];
export const SUBJECT_MAX = 72;

const SUBJECT = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9._/-]*\\))?(!)?: \\S`);

// Git writes these itself; they are not authored subjects.
const GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/;

// Attribution lines that must never appear in a commit message (AGENTS.md, CONTRIBUTING.md).
const ATTRIBUTION = [
  /^co-authored-by:.*(claude|anthropic|openai|chatgpt|copilot|gemini|codex|cursor|\bgpt\b|\bAI\b)/im,
  /generated with \[?claude code/i,
  /claude\.ai\/code\/session/i,
  /^\u{1F916}/mu,
];

/**
 * Checks one commit message.
 * @param {string} message The full message text.
 * @returns {string[]} One entry per problem; empty when the message follows the standard.
 */
export function checkMessage(message) {
  const lines = String(message).replace(/\r\n/g, '\n').split('\n').filter((line) => !line.startsWith('#'));

  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }

  const problems = [];
  const subject = lines[0] ?? '';

  if (subject === '') {
    return ['the message is empty'];
  }

  const body = lines.slice(1).join('\n');

  for (const pattern of ATTRIBUTION) {
    if (pattern.test(subject) || pattern.test(body)) {
      problems.push('contains an AI attribution line, which this repository does not allow');
      break;
    }
  }

  if (GENERATED.test(subject)) {
    return problems;
  }

  if (!SUBJECT.test(subject)) {
    problems.push(`subject must be "<type>(<scope>): <summary>" with type one of ${TYPES.join(', ')}; got "${subject}"`);
  }

  if (subject.length > SUBJECT_MAX) {
    problems.push(`subject is ${subject.length} characters; the limit is ${SUBJECT_MAX}`);
  }

  if (subject.endsWith('.')) {
    problems.push('subject must not end with a period');
  }

  if (lines.length > 1 && lines[1].trim() !== '') {
    problems.push('the line after the subject must be blank');
  }

  if (SUBJECT.exec(subject)?.[3] === '!' && !/^BREAKING CHANGE: \S/m.test(body)) {
    problems.push('a "!" subject needs a "BREAKING CHANGE: <what breaks>" line in the body');
  }

  return problems;
}
