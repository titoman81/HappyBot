# Deployment notes — make project deployable with STT

This project includes optional speech-to-text (STT) helpers using Whisper.

To deploy to platforms like Railway or render, use the included `Dockerfile`. The Docker image installs `ffmpeg` system package and Python runtime, and attempts to install Python requirements from `requirements.txt`.

Steps to deploy from your machine:

1. Commit and push your branch to GitHub:

```bash
git add .
git commit -m "Add STT deps and Dockerfile for deployment"
git push origin main
```

2. On Railway (or similar), connect the GitHub repo and select `Deploy from Dockerfile` (Railway will build using the provided Dockerfile).

Notes and caveats:
- `openai-whisper` requires `torch`. Installing `torch` in some environments can be heavy; if your Railway plan has build limits, consider using an external STT API or a lightweight backend like `whisper.cpp`.
- If Docker build fails due to `openai-whisper`/`torch` wheels, you can remove `openai-whisper` from `requirements.txt` and rely on a hosted STT service or compile wheels externally.
- The Dockerfile uses Debian `bullseye` base (Node 20). Modify if you need a different distro.

If you want, I can: generate a Git commit for you locally (files are created), and provide the exact `git` commands to push the changes to your GitHub remote. I cannot push to GitHub from here unless you run the commands.
