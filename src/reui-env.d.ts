// O event-calendar (reui) referencia `process.env.NODE_ENV` para emitir avisos
// só em desenvolvimento. O Vite substitui esse trecho em tempo de build, então
// isto é apenas uma declaração de tipo mínima para o tsc — sem puxar @types/node
// (que o tsconfig.app evita de propósito por causa do bloco Plate).
export {};

declare global {
  const process: { env: { NODE_ENV?: string } };
}
