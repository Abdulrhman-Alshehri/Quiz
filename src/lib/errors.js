// Database functions raise short codes (for example NAME_TAKEN). This file turns
// them into plain-language messages that say what happened and what to do next.
const MESSAGES = {
  NETWORK: 'لا يوجد اتصال الآن. تحقق من الإنترنت؛ الصفحة تعيد المحاولة تلقائيًا.',
  NOT_CONFIGURED: 'هذه النسخة من المسابقة غير مرتبطة بقاعدة بيانات بعد.',
  SESSION_NOT_FOUND: 'لا توجد مسابقة بهذا الرمز. تحقق من الرمز على الشاشة الكبيرة وحاول مرة أخرى.',
  SESSION_ENDED: 'انتهت هذه المسابقة.',
  REGISTRATION_CLOSED: 'الانضمام مغلق في هذه المسابقة. اطلب من المقدم إعادة فتحه.',
  NAME_REQUIRED: 'اكتب اسمك للانضمام.',
  NAME_TOO_LONG: 'استخدم 30 حرفًا أو أقل.',
  NAME_INVALID: 'احذف الرموز الخاصة من اسمك.',
  NAME_TAKEN: 'انضم شخص بهذا الاسم من قبل. أضف الحرف الأول من اسم العائلة أو اسم فرعك، مثل «عمر ج».',
  PARTICIPANT_NOT_FOUND: 'تعذر العثور على مكانك في هذه المسابقة. انضم مرة أخرى باسمك.',
  PARTICIPANT_REMOVED: 'أزال المقدم هذا الاسم من المسابقة.',
  QUESTION_CLOSED: 'هذا السؤال مغلق بالفعل.',
  QUESTION_NOT_ACTIVE: 'هذا السؤال لم يعد مفتوحًا.',
  QUESTION_PAUSED: 'أوقف المقدم المسابقة مؤقتًا، فلم تُرسل إجابتك. حاول مرة أخرى عند الاستئناف.',
  QUESTION_NOT_STARTED: 'تفتح الإجابات عند بدء المؤقت.',
  DEADLINE_PASSED: 'انتهى الوقت قبل وصول إجابتك.',
  INVALID_OPTION: 'اختر من الإجابات المعروضة.',
  ADMIN_AUTH_REQUIRED: 'انتهت صلاحية دخولك كمقدم. سجل الدخول مرة أخرى.',
  INVALID_PASSCODE: 'رمز المرور غير صحيح.',
  TOO_MANY_ATTEMPTS: 'محاولات خاطئة كثيرة من هذه الشبكة. انتظر 15 دقيقة ثم حاول مرة أخرى.',
  ADMIN_NOT_CONFIGURED: 'لم يُضبط رمز مرور المقدم بعد. راجع قسم ضبط رمز المرور في ملف README.',
  PASSCODE_TOO_SHORT: 'يجب أن يكون رمز المرور الجديد من 10 إلى 72 حرفًا.',
  BANK_NOT_READY: 'بنك الأسئلة غير جاهز لإنشاء جلسة. افتح «تحرير الأسئلة» لترى السبب.',
  BANK_CONFLICT: 'تغيّر هذا العنصر من جهاز آخر بعد أن فتحته. أعدنا تحميل البنك؛ راجع التغيير ثم أعد المحاولة.',
  QUESTION_LIMIT: 'وصل هذا الفصل إلى الحد الأقصى من الأسئلة (10). أوقف سؤالًا أو انقله إلى فصل آخر.',
  CHAPTER_LIMIT: 'وصل البنك إلى الحد الأقصى من الفصول (10). أوقف فصلًا أولًا.',
  BANK_NEEDS_CHAPTER: 'يحتاج البنك إلى فصل واحد على الأقل. أضف فصلًا جديدًا قبل إيقاف هذا الفصل.',
  CHAPTER_RETIRED: 'هذا الفصل موقوف. استعده أولًا.',
  QUESTION_RETIRED: 'هذا السؤال موقوف. استعده أولًا.',
  QUESTION_NOT_FOUND: 'لم يُعثر على هذا السؤال. حدّث الصفحة.',
  CHANGE_NOT_FOUND: 'لم يُعثر على هذه النسخة في السجل.',
  ORDER_MISMATCH: 'تغيّر ترتيب البنك من جهاز آخر. أعدنا تحميله؛ حاول مرة أخرى.',
  QUESTION_IN_PROGRESS: 'اكشف إجابة السؤال الحالي أولًا.',
  CHAPTER_COMPLETED: 'انتهى هذا الفصل. أعد تعيينه إذا أردت لعبه مرة أخرى.',
  CHAPTER_NOT_FOUND: 'لم يُعثر على هذا الفصل. حدّث الصفحة.',
  CHAPTER_NOT_FINISHED: 'بعض أسئلة هذا الفصل لم تُعرض بعد.',
  NO_ACTIVE_CHAPTER: 'ابدأ فصلًا أولًا.',
  NO_MORE_QUESTIONS: 'عُرضت كل أسئلة هذا الفصل.',
  INVALID_PHASE: 'هذه الخطوة لم تعد متاحة، وتم تحديث لوحة التحكم.',
  CONFIRMATION_REQUIRED: 'اكتب كلمة التأكيد للمتابعة.',
  SESSION_NOT_FOUND_OR_ENDED: 'انتهت هذه الجلسة.',
  TITLE_TOO_LONG: 'استخدم 120 حرفًا أو أقل لعنوان الجلسة.',
  UNKNOWN: 'حدث خطأ ما. حاول مرة أخرى.',
};

export class QuizError extends Error {
  constructor(code, detail) {
    super(MESSAGES[code] || detail || code || 'حدث خطأ ما.');
    this.name = 'QuizError';
    this.code = code;
    this.detail = detail;
  }
}

// For codes whose message comes from the database (a reason in Arabic after the colon).
function detailed(code, message) {
  const e = new QuizError(code);
  e.message = message;
  return e;
}

const NETWORK_PATTERN = /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout/i;

export function fromSupabaseError(error) {
  const raw = String(error?.message || '');
  if ((!error?.code || error.code === '') && NETWORK_PATTERN.test(raw)) {
    return new QuizError('NETWORK', raw);
  }
  // Codes can carry a reason after a colon, e.g. "QUESTION_INVALID:حدّد الإجابة الصحيحة".
  const idx = raw.indexOf(':');
  const head = (idx === -1 ? raw : raw.slice(0, idx)).trim();
  const tail = idx === -1 ? '' : raw.slice(idx + 1).trim();
  // Bank checks explain the problem in Arabic after the colon; it is shown after a short lead-in.
  if (head === 'BANK_INVALID') return new QuizError('BANK_INVALID', `لم يُستورد بنك الأسئلة. السبب: ${tail}`);
  if (head === 'BANK_NOT_READY' && tail) return detailed('BANK_NOT_READY', `لا يمكن إنشاء جلسة بعد: ${tail}`);
  if (head === 'QUESTION_INVALID') return detailed('QUESTION_INVALID', `لم يُحفظ السؤال: ${tail || 'بيانات غير صالحة'}.`);
  if (head === 'CHAPTER_INVALID') return detailed('CHAPTER_INVALID', `لم يُحفظ الفصل: ${tail || 'بيانات غير صالحة'}.`);
  if (head === 'INVALID_SETTING') return new QuizError('INVALID_SETTING', `قيمة الإعداد غير مسموح بها (${tail}).`);
  if (/^[A-Z_]+$/.test(head)) return new QuizError(head, tail || undefined);
  return new QuizError('UNKNOWN');
}

export function messageFor(err) {
  if (!err) return '';
  if (err instanceof QuizError) return err.message;
  return String(err.message || err);
}
