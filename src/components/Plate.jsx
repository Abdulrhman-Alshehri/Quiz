// The join code on a white card in brand blue, split in two groups so it reads
// as "ABC 234" from the back of a training room. The code is Latin letters and
// digits, so it is always laid out left to right inside the Arabic page.
export function Plate({ code, size = 'm', caption }) {
  const clean = String(code || '').toUpperCase();
  const first = clean.slice(0, 3);
  const second = clean.slice(3);
  return (
    <figure className={`plate plate--${size}`}>
      <div className="plate__body" dir="ltr" role="img" aria-label={`رمز الانضمام ${clean.split('').join(' ')}`}>
        <span className="plate__code" aria-hidden="true">
          <span>{first}</span>
          <span>{second}</span>
        </span>
      </div>
      {caption && <figcaption className="plate__caption">{caption}</figcaption>}
    </figure>
  );
}
