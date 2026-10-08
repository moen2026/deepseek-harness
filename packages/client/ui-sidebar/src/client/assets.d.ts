/** Brand artwork imports are embedded in the sidebar client bundle. */
declare module '*.png' {
  const url: string
  export default url
}
