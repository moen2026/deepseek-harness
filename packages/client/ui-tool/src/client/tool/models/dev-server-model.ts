/** Dev-server preview derivation from raw shell result text. @module */

/** A loopback dev-server URL found in shell output, ready for a preview link. */
export interface DevServerPreview {
  /** The URL exactly as the tool printed it, opened in a new tab on click. */
  readonly url: string
  /** The `host:port` fragment shown as the collapsed row's suffix. */
  readonly host: string
}

/**
 * A dev-server banner URL (`Local: http://localhost:5173/`, webpack, next,
 * and friends) whose host is one of the loopback bindings. Restricting the
 * match to loopback keeps the link from pointing at an arbitrary remote
 * address the output happens to name; a LAN URL stays plain text.
 */
const DEV_SERVER_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\[::\]):(\d{1,5})(?!\d)(?:[/?#][^\s"']*)?/

/**
 * Find the first loopback dev-server URL in a shell result. A dev server
 * prints its binding once it accepts connections, so the URL's presence is
 * the ready signal; a printed-but-invalid port yields no preview.
 * @param output - the flattened result text of a process-output tool call.
 * @returns the first loopback preview, or undefined when none is present.
 */
export function devServerPreview(output: string): DevServerPreview | undefined {
  const match = DEV_SERVER_URL.exec(output)
  if (match === null) return undefined
  const port = Number(match[1])
  if (port < 1 || port > 65535) return undefined
  const url = match[0]
  const authority = url.slice(url.indexOf('://') + 3)
  const pathStart = authority.search(/[/?#]/)
  return { url, host: pathStart === -1 ? authority : authority.slice(0, pathStart) }
}
