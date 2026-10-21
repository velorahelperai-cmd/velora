export function redactLogText(value){
 return String(value)
  .replace(/([?&](?:email|phone|code|state|nonce|pin|verify_token|hub\.verify_token|appsecret_proof|token|access_token|refresh_token|password|api_key)=)[^&\s]+/gi,'$1[REDACTED]')
  .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[REDACTED]@')
  .replace(/\bBearer\s+[^\s"',;]+/gi,'Bearer [REDACTED]')
  .replace(/\bsha256=[a-f0-9]{16,128}\b/gi,'sha256=[REDACTED]')
  .replace(/\b(?:EAA|IGQ|IGAA)[A-Za-z0-9_-]{16,}\b/g,'[REDACTED]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[REDACTED]')
  .replace(/\b(password|(?:access|refresh|id|session|verify|claim|attempt)[_-]?token|client[_-]?secret|oauth[_-]?secret|app[_-]?secret|appsecret[_-]?proof|x-hub-signature(?:-256)?|stage[_-]?receipt|claim[_-]?receipt|oauth[_-]?state|nonce|pin|token|secret|api[_-]?key|authorization|cookie)\b["']?\s*[:=]\s*["'][^"']*["']/gi,'$1=[REDACTED]')
  .replace(/\b(password|(?:access|refresh|id|session|verify|claim|attempt)[_-]?token|client[_-]?secret|oauth[_-]?secret|app[_-]?secret|appsecret[_-]?proof|x-hub-signature(?:-256)?|stage[_-]?receipt|claim[_-]?receipt|oauth[_-]?state|nonce|pin|token|secret|api[_-]?key|authorization|cookie)\b["']?\s*[:=]\s*["']?[^\s,"';}]+/gi,'$1=[REDACTED]')
  .replace(/\b([a-z0-9._%+-])[a-z0-9._%+-]*@([a-z0-9.-]+\.[a-z]{2,})\b/gi,'$1***@$2');
}
