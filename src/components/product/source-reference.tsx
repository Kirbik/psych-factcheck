type SourceReferenceProps = {
  citation: string;
  title: string;
};

export function SourceReference({ citation, title }: SourceReferenceProps) {
  return (
    <cite className="source-reference">
      <strong>{title}</strong>
      <span>{citation}</span>
    </cite>
  );
}
