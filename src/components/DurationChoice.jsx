// Time per question: as set on each question in the bank, or one time for all.
export function DurationChoice({ timing, seconds, onTiming, onSeconds, name, disabled }) {
  return (
    <fieldset className="field">
      <legend className="field__label">مدة كل سؤال</legend>
      <label className="choice">
        <input type="radio" name={name} value="bank" checked={timing === 'bank'} disabled={disabled} onChange={() => onTiming('bank')} />
        <span>كما في بنك الأسئلة (لكل سؤال مدته، موصى به)</span>
      </label>
      <label className="choice choice--inline">
        <input type="radio" name={name} value="fixed" checked={timing === 'fixed'} disabled={disabled} onChange={() => onTiming('fixed')} />
        <span>مدة موحدة لكل الأسئلة:</span>
        <input
          className="input input--num"
          type="number"
          min={5}
          max={120}
          value={seconds}
          disabled={disabled || timing !== 'fixed'}
          onChange={(e) => onSeconds(e.target.value)}
          aria-label="عدد الثواني لكل سؤال"
          required
        />
        <span>ثانية</span>
      </label>
    </fieldset>
  );
}
