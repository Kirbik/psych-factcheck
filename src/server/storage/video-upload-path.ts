import { z } from "zod";

const generatedObjectNameSchema =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\.mp4|\.webm|\.mov)$/iu;

export function isOwnedGeneratedVideoPath(path: string, userId: string) {
  const [ownerId, objectName, ...extraSegments] = path.split("/");
  if (ownerId !== userId || !objectName || extraSegments.length > 0) return false;
  const match = generatedObjectNameSchema.exec(objectName);
  return Boolean(match && z.string().uuid().safeParse(match[1]).success);
}
