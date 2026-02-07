/* eslint-disable */
interface BunSpawnOptions {
  cmd: string[]
  cwd?: string
  stdin?: "pipe"
  stdout?: "pipe"
  stderr?: "pipe"
}

interface BunSpawnProcess {
  stdin?: WritableStream<Uint8Array>
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
}

declare const Bun: {
  file(path: string): { text(): Promise<string> }
  spawn(options: BunSpawnOptions): BunSpawnProcess
}
