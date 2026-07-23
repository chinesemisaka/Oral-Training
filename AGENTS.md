# Repository Guidelines

## Project Structure & Module Organization

This repository contains a WeChat Mini Program MVP and its Windows C++ backend for dental customer-service training. Application-wide Mini Program setup lives in `app.js`, `app.json`, and `app.wxss`. Feature pages are organized under `pages/<feature>/` and each page normally contains a matching `.js`, `.json`, `.wxml`, and `.wxss` file. Current flows include `home`, `index`, `training`, `result`, `report`, and `admin`.

Put reusable client-side logic in `utils/`; `utils/api.js` and `utils/config.js` own the backend API client and runtime configuration. Store tab icons and other runtime assets in `static/`. The backend source, migration, packaging scripts, and PowerShell smoke tests live in `backend/`; its HTTP server is implemented in `backend/src/main.cpp`. Product requirements and API notes belong in `docs/`.

## Build, Test, and Development Commands

There is no npm package or Mini Program command-line build pipeline. Open the repository directory in WeChat DevTools as a Mini Program project, then use:

- **Compile** to build and run the simulator.
- **Preview** to test on a device through a generated preview build.
- **Upload** only after manually validating the MVP flow.

`project.config.json` defines the shared DevTools settings; keep `project.private.config.json` limited to developer-specific settings. Before committing, review `git diff --check` and inspect the changed flow in the simulator.

The backend is a Windows C++17/CMake project and requires PostgreSQL development libraries. Build it with `cmake -S backend -B backend/build-msvc -G 'Visual Studio 17 2022' -A x64` and `cmake --build backend/build-msvc --config Release`; run its CTest suite with `ctest --test-dir backend/build-msvc -C Release --output-on-failure`. Use `backend/tests/smoke.ps1` for HTTP smoke testing. See `README.md` and `backend/README.md` for the supported local and portable-package workflows.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, semicolons, and ES6 syntax consistent with existing files. Name page folders and files in lowercase (for example, `pages/training/training.js`). Use `camelCase` for JavaScript variables/functions, `PascalCase` only for constructors, and descriptive `kebab-case` for WXML class names. Keep page behavior in its page controller and extract shared, storage-related, or rule-based logic to `utils/`.

For backend C++, follow the conventions already used in `backend/src/main.cpp`, keep CMake target changes in `backend/CMakeLists.txt`, and do not add secrets to `backend/.env` (use `backend/.env.example` as the template).

## Testing Guidelines

No automated Mini Program test framework is configured. Manually test the affected user journey in WeChat DevTools: start a scenario, send messages, finish training, view the result, and confirm report/admin history reflects saved data. For backend changes, run the CTest suite and relevant `backend/tests/smoke.ps1` coverage in addition to exercising the affected Mini Program API flow. Add automated tests alongside new tooling when practical.

## Commit & Pull Request Guidelines

Follow the existing Conventional Commit style: `feat: ...`, `fix: ...`, `refactor: ...`, or `docs: ...`. Keep each commit focused. Pull requests should explain the user-visible change, list manual validation performed, link related requirements/issues, and include screenshots or a short recording for WXML/WXSS UI changes. Do not commit credentials, generated local state, or unrelated DevTools configuration changes.
