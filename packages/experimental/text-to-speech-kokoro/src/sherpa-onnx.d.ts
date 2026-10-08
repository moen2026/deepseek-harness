/** Minimal surface of the CommonJS Node-API binding used by the synthesis worker. */
declare module 'sherpa-onnx-node' {
  export class OfflineTts {
    constructor(config: object)
    generate(call: { text: string; sid: number; speed: number }): { samples: Float32Array; sampleRate: number }
  }
  /** The binding is CommonJS; Node's ESM named-export detection cannot see its properties. */
  const binding: { OfflineTts: typeof OfflineTts }
  export default binding
}
