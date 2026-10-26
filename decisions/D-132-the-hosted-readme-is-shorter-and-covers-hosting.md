## D-132 · 2026-10-26 · The hosted README is shorter and covers hosting setup and auto-update
`hosted/README.md` is reorganised: quick start, configuring (env file, reverse proxy with TLS, Claude and GitHub sign-in), updating, then the architecture notes and the "not safe yet" list. Updating includes a short bash script that pulls the image, compares it with the running container's and recreates the container only if newer, with a nightly cron line. The reverse-proxy and script examples were not run.
Why: user request.
