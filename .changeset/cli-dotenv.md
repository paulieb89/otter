---
"@otter/surface-cli": patch
---

CLI auto-loads .env from the launch directory (Node's loadEnvFile, no new
dependency); shell-exported variables take precedence.
