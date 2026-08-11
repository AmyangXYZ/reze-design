/**
 * What this build is, for the chrome that says so.
 *
 * One export, read from package.json through next.config.ts, because two places
 * render this and both had drifted: the header sat on 0.4.0 through the 0.4.1
 * release and the older chrome still read 0.3.4. A badge whose whole job is to
 * identify the build is worse than no badge when it lies about it.
 *
 * "beta" is the PHASE and lives here, not in the manifest — npm wants a plain
 * semver number, and `0.4.1-beta` would make every published scene's version
 * pin read as a prerelease.
 */
export const VERSION_LABEL = `${process.env.NEXT_PUBLIC_APP_VERSION ?? ""} beta`.trim()
