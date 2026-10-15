import { supabase } from './supabase';
import { QuizError, fromSupabaseError } from './errors';

// One wrapper per database function. All game rules (deadlines, scoring, answer
// keys, who may do what) are enforced in the database, never in this file.
async function rpc(name, args = {}) {
  if (!supabase) throw new QuizError('NOT_CONFIGURED');
  let result;
  try {
    result = await supabase.rpc(name, args);
  } catch (e) {
    throw new QuizError('NETWORK', e?.message);
  }
  if (result.error) throw fromSupabaseError(result.error);
  return result.data;
}

export const api = {
  serverTime: () => rpc('get_server_time'),
  resolveSession: (code) => rpc('resolve_session', { p_code: code || null }),
  joinSession: (code, displayName) => rpc('join_session', { p_code: code, p_display_name: displayName }),
  participantState: (token) => rpc('get_participant_state', { p_token: token }),
  // optionIds: one id for single choice and true/false, one or more for multiple choice.
  submitAnswer: (token, questionId, optionIds) =>
    rpc('submit_answer', { p_token: token, p_question_id: questionId, p_option_ids: optionIds }),
  screenState: (code) => rpc('get_screen_state', { p_code: code }),

  admin: {
    login: (passcode) => rpc('admin_login', { p_passcode: passcode }),
    logout: (t) => rpc('admin_logout', { p_admin_token: t }),
    check: (t) => rpc('admin_check', { p_admin_token: t }),
    changePasscode: (t, current, next) =>
      rpc('admin_change_passcode', { p_admin_token: t, p_current: current, p_new: next }),
    listSessions: (t) => rpc('admin_list_sessions', { p_admin_token: t }),
    createSession: (t, title, settings) =>
      rpc('admin_create_session', { p_admin_token: t, p_title: title, p_settings: settings }),
    getSession: (t, id) => rpc('admin_get_session', { p_admin_token: t, p_session_id: id }),
    updateSettings: (t, id, settings) =>
      rpc('admin_update_settings', { p_admin_token: t, p_session_id: id, p_settings: settings }),
    setRegistration: (t, id, open) =>
      rpc('admin_set_registration', { p_admin_token: t, p_session_id: id, p_open: open }),
    startChapter: (t, id, chapterId) =>
      rpc('admin_start_chapter', { p_admin_token: t, p_session_id: id, p_chapter_id: chapterId }),
    nextQuestion: (t, id) => rpc('admin_next_question', { p_admin_token: t, p_session_id: id }),
    reveal: (t, id) => rpc('admin_reveal', { p_admin_token: t, p_session_id: id }),
    finishChapter: (t, id, force = false) =>
      rpc('admin_finish_chapter', { p_admin_token: t, p_session_id: id, p_force: force }),
    pause: (t, id) => rpc('admin_pause', { p_admin_token: t, p_session_id: id }),
    resume: (t, id) => rpc('admin_resume', { p_admin_token: t, p_session_id: id }),
    endSession: (t, id) => rpc('admin_end_session', { p_admin_token: t, p_session_id: id }),
    resetChapter: (t, id, chapterId, confirm) =>
      rpc('admin_reset_chapter', { p_admin_token: t, p_session_id: id, p_chapter_id: chapterId, p_confirm: confirm }),
    resetSession: (t, id, confirm) =>
      rpc('admin_reset_session', { p_admin_token: t, p_session_id: id, p_confirm: confirm }),
    removeParticipant: (t, participantId) =>
      rpc('admin_remove_participant', { p_admin_token: t, p_participant_id: participantId }),
    exportResults: (t, id) => rpc('admin_export_results', { p_admin_token: t, p_session_id: id }),
    exportItems: (t, id) => rpc('admin_export_item_analysis', { p_admin_token: t, p_session_id: id }),
    getBank: (t) => rpc('admin_get_bank', { p_admin_token: t }),
    importBank: (t, bank) => rpc('admin_import_bank', { p_admin_token: t, p_bank: bank }),
    saveChapter: (t, chapter) => rpc('admin_save_chapter', { p_admin_token: t, p_chapter: chapter }),
    retireChapter: (t, id) => rpc('admin_retire_chapter', { p_admin_token: t, p_chapter_id: id }),
    restoreChapter: (t, id) => rpc('admin_restore_chapter', { p_admin_token: t, p_chapter_id: id }),
    reorderChapters: (t, ids) => rpc('admin_reorder_chapters', { p_admin_token: t, p_chapter_ids: ids }),
    saveQuestion: (t, question) => rpc('admin_save_question', { p_admin_token: t, p_question: question }),
    retireQuestion: (t, id) => rpc('admin_retire_question', { p_admin_token: t, p_question_id: id }),
    restoreQuestion: (t, id) => rpc('admin_restore_question', { p_admin_token: t, p_question_id: id }),
    reorderQuestions: (t, chapterId, ids) =>
      rpc('admin_reorder_questions', { p_admin_token: t, p_chapter_id: chapterId, p_question_ids: ids }),
    questionHistory: (t, id) => rpc('admin_question_history', { p_admin_token: t, p_question_id: id }),
    revertQuestion: (t, id, changeId) =>
      rpc('admin_revert_question', { p_admin_token: t, p_question_id: id, p_change_id: changeId }),
  },
};
