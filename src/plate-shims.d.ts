// Shims para o bloco Plate (@plate/editor-ai), feito para Next.js. Alguns
// arquivos importam submódulos do lodash com sufixo .js, que o @types/lodash
// não resolve. Declaramos aqui para o tsc não reclamar (uso é interno do bloco).
declare module "lodash/*.js";
declare module "lodash/*";
