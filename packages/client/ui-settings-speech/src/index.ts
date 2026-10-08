/**
 * Speech synthesis settings page, node half. The empty apply exists so the
 * plugin appears in the host cordis.yml / Loader; the browser half owns the
 * page through exports["./client"], discovered from the package.json dsh.client
 * declaration. The page reads the `tts` Remote namespace the synthesis
 * controller serves, so this package registers no namespace of its own.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
