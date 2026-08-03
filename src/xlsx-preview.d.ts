// Shim de tipos para `xlsx-preview` (#189): o pacote publica um `.d.ts` em
// dist/ mas não aponta o campo `types` no package.json, então o TS não o acha.
// Declaramos a API que usamos (baseada no dist/index.d.ts do pacote).
declare module "xlsx-preview" {
  export interface XlsxOptions {
    output?: "string" | "arrayBuffer";
    separateSheets?: boolean;
    minimumRows?: number;
    minimumCols?: number;
  }
  export function xlsx2Html(
    data: ArrayBuffer | Blob | File,
    options?: XlsxOptions
  ): Promise<string | ArrayBuffer | string[]>;
  const _default: { xlsx2Html: typeof xlsx2Html };
  export default _default;
}
