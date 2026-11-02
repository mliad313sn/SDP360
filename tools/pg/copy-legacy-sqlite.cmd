@echo off
rem A-01: copy a 1.x SQLite store (assets.db) into PostgreSQL. Dry run by default; add --apply after a fresh pg_dump.
rem node:sqlite needs --experimental-sqlite on the bundled Node.js 22.11 (harmless on later 22.x).
if exist "%~dp0..\..\runtime\node\node.exe" (
  "%~dp0..\..\runtime\node\node.exe" --experimental-sqlite "%~dp0copy-legacy-sqlite.js" %*
) else (
  node --experimental-sqlite "%~dp0copy-legacy-sqlite.js" %*
)
exit /b %errorlevel%
