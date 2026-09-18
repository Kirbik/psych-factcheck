type TranscriptSegmentProps = {
  endTime: string;
  startTime: string;
  text: string;
};

export function TranscriptSegment({ endTime, startTime, text }: TranscriptSegmentProps) {
  return (
    <article className="transcript-segment">
      <time dateTime={`${startTime}/${endTime}`}>{startTime}–{endTime}</time>
      <p>{text}</p>
    </article>
  );
}
