export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
