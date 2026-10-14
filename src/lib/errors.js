// Database functions raise short codes (for example NAME_TAKEN). This file turns
// them into plain-language messages that say what happened and what to do next.
const MESSAGES = {
  NETWORK: 'No connection right now. Check your internet; the page keeps retrying.',
  NOT_CONFIGURED: 'This copy of the quiz is not connected to a database yet.',
  SESSION_NOT_FOUND: 'No quiz uses that code. Check the code on the big screen and try again.',
  SESSION_ENDED: 'This quiz has ended.',
  REGISTRATION_CLOSED: 'Joining is closed for this quiz. Ask the presenter to reopen it.',
  NAME_REQUIRED: 'Enter your name to join.',
  NAME_TOO_LONG: 'Use 30 characters or fewer.',
  NAME_INVALID: 'Remove special control characters from your name.',
  NAME_TAKEN: 'Someone already joined with that name. Add an initial or your branch, for example "Omar J."',
  PARTICIPANT_NOT_FOUND: 'Your place in this quiz could not be found. Join again with your name.',
  PARTICIPANT_REMOVED: 'The presenter removed this name from the quiz.',
  QUESTION_CLOSED: 'This question is already closed.',
  QUESTION_NOT_ACTIVE: 'That question is no longer open.',
  QUESTION_PAUSED: 'The presenter paused the quiz, so your answer was not sent. Try again when it resumes.',
  QUESTION_NOT_STARTED: 'Answers open when the timer starts.',
  DEADLINE_PASSED: 'Time ran out before your answer arrived.',
  INVALID_OPTION: 'Choose one of the four answers.',
  ADMIN_AUTH_REQUIRED: 'Your presenter sign-in has expired. Sign in again.',
  INVALID_PASSCODE: 'That passcode is not correct.',
  TOO_MANY_ATTEMPTS: 'Too many wrong passcodes from this network. Wait 15 minutes, then try again.',
  ADMIN_NOT_CONFIGURED: 'No presenter passcode is set yet. See "Set the presenter passcode" in the README.',
  PASSCODE_TOO_SHORT: 'Use 10 to 72 characters for the new passcode.',
  BANK_NOT_READY: 'The question bank needs 4 chapters with 5 questions each before you can create a session.',
  QUESTION_IN_PROGRESS: 'Reveal the current question first.',
  CHAPTER_COMPLETED: 'This chapter is finished. Reset it if you want to play it again.',
  CHAPTER_NOT_FOUND: 'That chapter is not part of this session.',
  CHAPTER_NOT_FINISHED: 'Some questions in this chapter have not been played yet.',
  NO_ACTIVE_CHAPTER: 'Start a chapter first.',
  NO_MORE_QUESTIONS: 'Every question in this chapter has been played.',
  INVALID_PHASE: 'That step is not available any more. The console has refreshed.',
  CONFIRMATION_REQUIRED: 'Type RESET to confirm.',
  SESSION_NOT_FOUND_OR_ENDED: 'This session has ended.',
  TITLE_TOO_LONG: 'Use 120 characters or fewer for the session title.',
};

export class QuizError extends Error {
  constructor(code, detail) {
    super(MESSAGES[code] || detail || code || 'Something went wrong.');
    this.name = 'QuizError';
    this.code = code;
    this.detail = detail;
  }
}

const NETWORK_PATTERN = /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout/i;

export function fromSupabaseError(error) {
  const raw = String(error?.message || '');
  if ((!error?.code || error.code === '') && NETWORK_PATTERN.test(raw)) {
    return new QuizError('NETWORK', raw);
  }
  // Codes can carry detail after a colon, e.g. "BANK_INVALID:chapter 2 must have exactly 5 questions".
  const idx = raw.indexOf(':');
  const head = (idx === -1 ? raw : raw.slice(0, idx)).trim();
  const tail = idx === -1 ? '' : raw.slice(idx + 1).trim();
  if (head === 'BANK_INVALID') return new QuizError('BANK_INVALID', `The question bank was not imported: ${tail}.`);
  if (head === 'INVALID_SETTING') return new QuizError('INVALID_SETTING', `That setting value is not allowed (${tail}).`);
  if (/^[A-Z_]+$/.test(head)) return new QuizError(head, tail || undefined);
  return new QuizError('UNKNOWN', raw || 'Something went wrong. Try again.');
}

export function messageFor(err) {
  if (!err) return '';
  if (err instanceof QuizError) return err.message;
  return String(err.message || err);
}
