# Open-Generative-AI — router

**What this is:** ATTOH fork of the open-source (MIT) "Open Generative AI" project — self-hosted AI image/video generation over 200+ models. Kept per the MIT-first doctrine: build on permissive OSS, extend on our branches (memory: `feedback_mit_open_source_first`).

**Ownership:** the fork and all `attoh/*` branches are ATTOH-owned; upstream credit per its LICENSE. Current active work: `attoh/higgsfield-cli-adapter` (Higgsfield CLI adapter for the content engine).

## Routing
- **Our changes** go on `attoh/*` branches — keep `main` cleanly rebasable on upstream.
- **Content-engine integration** (Higgsfield, render pipelines): canonical doctrine lives in `ATTOH-DIGITAL/brg-operations` → `_content/` + `reference_higgsfield_content_engine` / `reference_offline_video_factory` memories.
- **Video-stack canonical:** `ATTOH-DIGITAL/Attohdigital` `_docs/VIDEO-GENERATOR-RONALDO-UPGRADE-PLAN.md` (three-repo split: ATTOH=client/social, CrewOS=cinematic, BRG=systems).
- **Ecosystem hub:** `ATTOH-DIGITAL/brg-operations` → `CLAUDE.md` + `_core/system/MASTER-SYSTEM-MAP-2026-06-01.md`.

## No-go
No API keys in code or docker-compose (placeholders only). Doctrine + routing only in this file, ≤200 lines.
