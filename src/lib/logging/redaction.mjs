export function redactLogText(value){
 return String(value)
  .replace(/([?&](?:email|phone|code|token|access_token|refresh_token|password|api_key)=)[^&\s]+/gi,'$1[REDACTED]')
  .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[REDACTED]@')
  .replace(/\bBearer\s+[^\s"',;]+/gi,'Bearer [REDACTED]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[REDACTED]')
  .replace(/\b(password|(?:access|refresh|id|session)[_-]?token|client[_-]?secret|oauth[_-]?secret|token|secret|api[_-]?key|authorization|cookie)\b["']?\s*[:=]\s*["'][^"']*["']/gi,'$1=[REDACTED]')
  .replace(/\b(password|(?:access|refresh|id|session)[_-]?token|client[_-]?secret|oauth[_-]?secret|token|secret|api[_-]?key|authorization|cookie)\b["']?\s*[:=]\s*["']?[^\s,"';}]+/gi,'$1=[REDACTED]')
  .replace(/\b([a-z0-9._%+-])[a-z0-9._%+-]*@([a-z0-9.-]+\.[a-z]{2,})\b/gi,'$1***@$2');
}
