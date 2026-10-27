/**
 * Streaming LZ4 Frame Decompressor & Endpoint Probe
 * Supports RFC-compliant LZ4 Frame streaming (magic 0x184D2204)
 * Decodes blocks on the fly without accumulating the full compressed archive in memory.
 */
import lz4js from "lz4js";

export const LZ4_FRAME_MAGIC = 0x184D2204;

export interface Lz4ProbeResult {
  available: boolean;
  endpointUrl: string;
  totalBytes?: number | null;
  error?: string;
}

export const CLASSIFY_LZ4_URL = "https://i.gogingko.net/api/v1/v/exchange/classify.json.lz4";
export const CLASSIFY_RAW_URL = "https://i.gogingko.net/api/v1/v/exchange/classify.json";

// Aliases for compatibility
export const LZ4_REMOTE_ENDPOINT = CLASSIFY_LZ4_URL;
export const RAW_REMOTE_ENDPOINT = CLASSIFY_RAW_URL;
export const LZ4_DEFAULT_ENDPOINT = CLASSIFY_LZ4_URL;
export const RAW_DEFAULT_ENDPOINT = CLASSIFY_RAW_URL;

/**
 * Probes whether the compressed LZ4 endpoint is available and valid on i.gogingko.net.
 * Uses a CORS-friendly HEAD pre-check first, with a generous 12s timeout and
 * first-chunk stream inspection fallback. Never downloads the entire compressed archive.
 */
export async function probeLz4Endpoint(
  endpointUrl: string = CLASSIFY_LZ4_URL,
  timeoutMs = 12000
): Promise<Lz4ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort(
        new DOMException(`LZ4 probe timed out after ${timeoutMs}ms`, "TimeoutError")
      );
    } catch {
      controller.abort();
    }
  }, timeoutMs);

  try {
    // Phase 1: Fast CORS-friendly HEAD check (no body, no Range preflight overhead)
    try {
      const headRes = await fetch(endpointUrl, {
        method: "HEAD",
        signal: controller.signal
      });
      if (headRes.status === 200) {
        clearTimeout(timer);
        const cl = headRes.headers.get("content-length");
        const totalBytes = cl ? parseInt(cl, 10) : 16753596;
        return {
          available: true,
          endpointUrl,
          totalBytes
        };
      } else if (headRes.status === 404) {
        clearTimeout(timer);
        return {
          available: false,
          endpointUrl,
          error: "HTTP 404: Key classify.json.lz4 not found on server"
        };
      }
    } catch (headErr: any) {
      // If HEAD is blocked or aborted early, inspect if timer fired
      if (controller.signal.aborted) {
        throw controller.signal.reason || headErr;
      }
      // If HEAD was disallowed by CORS policy, continue to stream slice verification
    }

    // Phase 2: GET first packet to verify LZ4 frame magic header (0x184D2204)
    const res = await fetch(endpointUrl, {
      method: "GET",
      headers: { Range: "bytes=0-15" },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (res.status === 404 || (!res.ok && res.status !== 206)) {
      return {
        available: false,
        endpointUrl,
        error: `HTTP ${res.status}: ${res.statusText || 'Not Found'}`
      };
    }

    // Check Content-Range or Content-Length for total size
    let totalBytes: number | null = null;
    const cr = res.headers.get("content-range");
    if (cr) {
      const match = cr.match(/\/(\d+)/);
      if (match) totalBytes = parseInt(match[1], 10);
    } else {
      const cl = res.headers.get("content-length");
      if (cl && (res.status === 200 || res.status === 206)) {
        totalBytes = parseInt(cl, 10);
      }
    }

    if (!res.body) {
      return {
        available: false,
        endpointUrl,
        error: "Empty response body"
      };
    }

    // Read only the first chunk (16+ bytes) and immediately cancel the stream
    const reader = res.body.getReader();
    const { value } = await reader.read();
    await reader.cancel();

    if (!value || value.byteLength < 4) {
      return {
        available: false,
        endpointUrl,
        error: "Probe response too short"
      };
    }

    // Check if server returned error JSON (e.g. {"state":1,"info":"...not found"})
    if (value[0] === 0x7B /* '{' */) {
      const text = new TextDecoder().decode(value);
      if (text.includes('"state":1') || text.includes('not found')) {
        return {
          available: false,
          endpointUrl,
          error: "Key classify.json.lz4 not found on server"
        };
      }
    }

    // Verify LZ4 Frame Magic: 0x04, 0x22, 0x4D, 0x18 (little-endian 0x184D2204)
    if (
      value[0] === 0x04 &&
      value[1] === 0x22 &&
      value[2] === 0x4D &&
      value[3] === 0x18
    ) {
      return {
        available: true,
        endpointUrl,
        totalBytes: totalBytes || 16753596
      };
    }

    return {
      available: false,
      endpointUrl,
      error: `Invalid LZ4 frame header magic: 0x${value[0].toString(16)}${value[1].toString(16)}`
    };
  } catch (err: any) {
    clearTimeout(timer);
    const isAborted = controller.signal.aborted || err?.name === "AbortError";
    const reasonMsg = controller.signal.reason?.message || err?.message || "Probe request failed";
    return {
      available: false,
      endpointUrl,
      error: isAborted ? (reasonMsg.includes("timed out") ? reasonMsg : `Probe timed out after ${timeoutMs}ms`) : reasonMsg
    };
  }
}

/**
 * Stream-oriented LZ4 Frame Decompressor.
 * Emits decompressed Uint8Array chunks as blocks arrive from the network.
 */
export class StreamingLz4FrameDecoder {
  private onChunk: (decompressedBytes: Uint8Array) => void;
  private buffer: Uint8Array = new Uint8Array(0);
  private headerParsed = false;
  private maxBlockSize = 4 * 1024 * 1024;
  private useBlockSum = false;
  private useContentSum = false;
  private useContentSize = false;
  private blockIndep = true;
  private isDone = false;
  private outBuf: Uint8Array;

  constructor(onChunk: (decompressedBytes: Uint8Array) => void) {
    this.onChunk = onChunk;
    this.outBuf = new Uint8Array(this.maxBlockSize);
  }

  /**
   * Appends incoming network chunk and decodes any completed LZ4 blocks.
   */
  public append(chunk: Uint8Array): void {
    if (this.isDone || chunk.byteLength === 0) return;

    // Concatenate existing partial buffer and new chunk
    if (this.buffer.byteLength === 0) {
      this.buffer = chunk;
    } else {
      const combined = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
      combined.set(this.buffer, 0);
      combined.set(chunk, this.buffer.byteLength);
      this.buffer = combined;
    }

    this.process();
  }

  private process(): void {
    let offset = 0;

    // 1. Parse Frame Header
    if (!this.headerParsed) {
      if (this.buffer.byteLength < 7) return; // Need at least magic(4) + flags(1) + bs(1) + hc(1)

      const magic =
        this.buffer[0] |
        (this.buffer[1] << 8) |
        (this.buffer[2] << 16) |
        (this.buffer[3] << 24);

      if (magic !== LZ4_FRAME_MAGIC) {
        throw new Error(
          `Invalid LZ4 frame magic: 0x${(magic >>> 0).toString(16).toUpperCase()} (expected 0x184D2204)`
        );
      }

      const descriptor = this.buffer[4];
      const version = (descriptor >> 6) & 3;
      if (version !== 1) {
        throw new Error(`Unsupported LZ4 frame version: ${version}`);
      }

      this.blockIndep = ((descriptor >> 5) & 1) === 1;
      this.useBlockSum = ((descriptor >> 4) & 1) === 1;
      this.useContentSize = ((descriptor >> 3) & 1) === 1;
      this.useContentSum = ((descriptor >> 2) & 1) === 1;

      const bsId = (this.buffer[5] >> 4) & 7;
      const bsMap: Record<number, number> = {
        4: 65536,
        5: 262144,
        6: 1048576,
        7: 4194304
      };
      this.maxBlockSize = bsMap[bsId] || 4194304;
      if (this.outBuf.byteLength < this.maxBlockSize) {
        this.outBuf = new Uint8Array(this.maxBlockSize);
      }

      let headerLen = 7;
      if (this.useContentSize) headerLen += 8;
      if (this.buffer.byteLength < headerLen) return;

      offset = headerLen;
      this.headerParsed = true;
    }

    // 2. Decode contiguous blocks as they arrive
    while (offset + 4 <= this.buffer.byteLength) {
      const compSize =
        (this.buffer[offset] |
          (this.buffer[offset + 1] << 8) |
          (this.buffer[offset + 2] << 16) |
          (this.buffer[offset + 3] << 24)) >>>
        0;

      offset += 4;

      // End of Frame marker
      if (compSize === 0) {
        if (this.useContentSum) {
          offset += 4;
        }
        this.isDone = true;
        break;
      }

      const isUncompressed = (compSize & 0x80000000) !== 0;
      const blockSize = isUncompressed ? compSize & 0x7fffffff : compSize;
      const totalBlockBytes = blockSize + (this.useBlockSum ? 4 : 0);

      // Check if block has arrived completely
      if (offset + totalBlockBytes > this.buffer.byteLength) {
        // Incomplete block: backtrack offset by 4 and wait for more stream chunks
        offset -= 4;
        break;
      }

      if (isUncompressed) {
        const rawSlice = this.buffer.slice(offset, offset + blockSize);
        this.onChunk(rawSlice);
      } else {
        // Decompress block into reusable buffer
        const written = lz4js.decompressBlock(
          this.buffer,
          this.outBuf,
          offset,
          blockSize,
          0
        );
        const decompressedSlice = this.outBuf.slice(0, written);
        this.onChunk(decompressedSlice);
      }

      offset += totalBlockBytes;
    }

    // Retain only unparsed remaining bytes
    if (offset > 0) {
      this.buffer = this.buffer.slice(offset);
    }
  }

  /**
   * Finalizes the stream and flushes any completed items.
   */
  public finish(): void {
    if (!this.isDone && this.buffer.byteLength > 0) {
      this.process();
    }
  }

  public get completed(): boolean {
    return this.isDone;
  }
}
