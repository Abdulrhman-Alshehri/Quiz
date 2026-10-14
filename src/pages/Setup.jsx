import { BluePage } from '../components/Brand';

// Shown when the build has no Supabase settings, instead of a broken page.
export default function Setup() {
  return (
    <BluePage>
      <h1 className="h1">المسابقة غير مرتبطة بقاعدة البيانات بعد</h1>
      <div className="card">
        <p className="lead">
          تم تحميل الصفحة، لكن النسخة المنشورة لا تعرف أي مشروع Supabase تستخدم، لذلك لا يمكن لأحد الانضمام بعد.
        </p>
        <ol className="steps">
          <li>
            افتح الملف <code dir="ltr">.env.production</code> في المستودع واضبط <code dir="ltr">VITE_SUPABASE_URL</code> و
            <code dir="ltr">VITE_SUPABASE_PUBLISHABLE_KEY</code> (من لوحة Supabase: Project Settings ثم API Keys).
          </li>
          <li>احفظ التغيير في المستودع، وسيعيد سير عمل GitHub Pages بناء الموقع ونشره.</li>
          <li>أعد تحميل هذه الصفحة.</li>
        </ol>
        <p className="muted">استخدم المفتاح العام (publishable) فقط، ولا تضع أبدًا مفتاحًا سريًا أو مفتاح service-role في الموقع.</p>
      </div>
    </BluePage>
  );
}
