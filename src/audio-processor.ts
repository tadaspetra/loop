class AudioCaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;

    const pcm = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      pcm[index] = Math.max(-32768, Math.min(32767, Math.round(input[index] * 32767)));
    }
    this.port.postMessage({ pcm: pcm.buffer }, [pcm.buffer]);
    return true;
  }
}

registerProcessor('audio-capture', AudioCaptureProcessor);
