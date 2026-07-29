/**
 * Modelo de e-mail reutilizável. `corpo` é o HTML gerado pelo próprio Plate
 * (mesmo formato que o compose manda pro Graph), então inserir um template no
 * compose é só desserializar esse HTML de volta. `descricao` é um resumo curto
 * exibido junto do nome no seletor de templates (#135).
 *
 * A CRUD e a persistência vivem no `useAppStore` (slice `bridge`); este módulo
 * guarda só o tipo, a chave legada e os helpers de leitura/migração.
 */
export interface TemplateEmail {
  id: string;
  nome: string;
  descricao: string;
  corpo: string;
}

/** Chave do localStorage dos templates (owned pelo store único desde o #135). */
export const TEMPLATES_KEY = "bridge.templates";

/**
 * Leitura pontual dos templates crus (usada na hidratação do store, para
 * migrar registros antigos que não têm `descricao`).
 */
export function lerTemplates(): TemplateEmail[] {
  try {
    const bruto = localStorage.getItem(TEMPLATES_KEY);
    if (!bruto) return [];
    const lista = JSON.parse(bruto) as unknown;
    if (!Array.isArray(lista)) return [];
    return lista
      .filter(
        (t): t is TemplateEmail =>
          !!t &&
          typeof (t as TemplateEmail).id === "string" &&
          typeof (t as TemplateEmail).nome === "string" &&
          typeof (t as TemplateEmail).corpo === "string"
      )
      // `descricao` foi adicionada no #135: dados antigos não têm o campo.
      .map((t) => ({ ...t, descricao: normalizarDescricao(t) }));
  } catch {
    return [];
  }
}

/** Descrição do template, tolerando registros antigos sem o campo. */
export function normalizarDescricao(t: { descricao?: unknown }): string {
  return typeof t.descricao === "string" ? t.descricao : "";
}

/** Id local; `randomUUID` com queda para um id de tempo+aleatório. */
export function novoId(prefixo = "id"): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${prefixo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Id local do template. */
export function novoIdTemplate(): string {
  return novoId("tpl");
}
