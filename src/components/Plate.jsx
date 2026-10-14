// The join code on a white card in brand blue, split in two groups so it reads
// as "ABC 234" from the back of a training room.
export function Plate({ code, size = 'm', caption }) {
  const clean = String(code || '').toUpperCase();
  const first = clean.slice(0, 3);
  const second = clean.slice(3);
  return (
    <figure className={`plate plate--${size}`}>
      <div className="plate__body" role="img" aria-label={`Join code ${clean.split('').join(' ')}`}>
        <span className="plate__code" aria-hidden="true">
          <span>{first}</span>
          <span>{second}</span>
        </span>
      </div>
      {caption && <figcaption className="plate__caption">{caption}</figcaption>}
    </figure>
  );
}
