(function (global) {
  "use strict";
  const marker = { syncFormat: 2, workouts: {} };
  function supported() {
    return typeof global.CompressionStream === "function" &&
      typeof global.DecompressionStream === "function" &&
      typeof global.TextEncoder === "function" &&
      typeof global.TextDecoder === "function" &&
      typeof global.btoa === "function" &&
      typeof global.atob === "function";
  }
  async function pack(state) {
    if (!supported()) throw new Error("Este navegador no admite la compresión necesaria para sincronizar");
    const bytes = new global.TextEncoder().encode(JSON.stringify(state));
    const compressed = await new global.Response(
      new global.Blob([bytes]).stream().pipeThrough(new global.CompressionStream("gzip"))
    ).arrayBuffer();
    const view = new Uint8Array(compressed);
    let binary = "";
    for (let i = 0; i < view.length; i += 0x8000) {
      binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
    }
    const packedState = global.btoa(binary);
    if (packedState.length > 900000) throw new Error("El perfil comprimido supera el límite seguro de Firestore");
    return packedState;
  }
  async function unpack(data) {
    if (!data || !data.packedState) return data && data.state && !data.state.syncFormat ? data.state : null;
    if (data.state && data.state.syncFormat !== 2) {
      throw new Error("Una versión antigua de la app ha escrito sobre un documento comprimido; se requiere revisión");
    }
    if (!supported()) throw new Error("Este navegador no puede leer los entrenamientos comprimidos");
    const binary = global.atob(data.packedState);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = await new global.Response(
      new global.Blob([bytes]).stream().pipeThrough(new global.DecompressionStream("gzip"))
    ).text();
    const state = JSON.parse(json);
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Formato de la nube inválido");
    return state;
  }
  global.entrenoSyncCodec = { marker, pack, unpack, supported };
})(typeof globalThis !== "undefined" ? globalThis : window);
