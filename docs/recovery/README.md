# Smart Setup scoped recovery snapshot

This is an encrypted, limited prerelease snapshot, **not a full Supabase backup**. The manifest identifies included data and exclusions. Decryption has been verified; a SQL restore has not been tested. Production migration and activation approval remains a separate gate.

The AES-256-GCM key is kept outside this repository. Keep a separate secure offline copy of the key: losing it makes recovery impossible. Never commit the key or decrypted JSON.

Use PowerShell 7 to decrypt to a secure directory outside any Git checkout:

```powershell
./decrypt-smart-recovery.ps1 -KeyPath '<private-key-path>' -OutputPath '<private-directory>/snapshot.json'
```

The helper authenticates the ciphertext and checks both file hashes and record counts before writing. It does not connect to Supabase or apply SQL. Recovery requires separately reviewed database operations against the actual schema; do not blindly replay rows or function definitions.

This directory is excluded from Vercel deployment by `/docs/` in `.vercelignore`.
