type SpinnerProps = {
  label?: string;
};

export function Spinner({ label = "Загрузка" }: SpinnerProps) {
  return (
    <span className="spinner-status" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
