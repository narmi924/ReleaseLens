export function Orbit({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}): React.ReactElement {
  return (
    <div className={`orbit ${className}`} aria-hidden="true">
      <span className="orbit-core">{label}</span>
      <span className="orbit-satellite">↗</span>
    </div>
  );
}
