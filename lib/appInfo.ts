/**
 * The GitHub repository ("owner/repo") this build of HeliosGen belongs to.
 *
 * It decides where the in-app update check (`app/api/update-check`) looks for
 * new releases, where its "Download" button points, and where the sidebar's
 * GitHub star / fork buttons link.
 *
 * FORK OWNERS: change the default below to your own fork (e.g.
 * "your-name/HeliosGen"). Otherwise copies built from your fork will tell your
 * users to "update" to the upstream releases instead of yours.
 * Release builds made by `.github/workflows/release.yml` already set
 * NEXT_PUBLIC_GITHUB_REPO to the repository the workflow runs in, which wins
 * over the default. Like every NEXT_PUBLIC_* variable it is baked in at build
 * time, so it has to be set when the app is built, not when it runs.
 */
export const GITHUB_REPO: string =
  process.env.NEXT_PUBLIC_GITHUB_REPO || "SegFault42/HeliosGen";

/** https://github.com/<owner>/<repo> */
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

/** GitHub REST API base for the repo: https://api.github.com/repos/<owner>/<repo> */
export const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}`;
