import { usePersistedState } from "@/lib/persist";

/**
 * Modelo de e-mail reutilizável. `corpo` é o HTML gerado pelo próprio Plate
 * (mesmo formato que o compose manda pro Graph), então inserir um template no
 * compose é só desserializar esse HTML de volta.
 */
export interface TemplateEmail {
  id: string;
  nome: string;
  corpo: string;
}

/**
 * Chave do localStorage dos templates. Mesmo prefixo/estratégia da assinatura
 * (`bridge.assinatura`): tudo local, sem backend.
 */
export const TEMPLATES_KEY = "bridge.templates";

/** Lista de templates persistida em localStorage (fonte da verdade da CRUD). */
export function useTemplates() {
  return usePersistedState<TemplateEmail[]>(TEMPLATES_KEY, []);
}

/**
 * Leitura pontual, sem estado. O compose usa isto (e não o hook) porque ele
 * fica montado junto do Bridge: um `usePersistedState` lá dentro guardaria uma
 * cópia velha e a regravaria por cima do que foi editado em Configurações.
 */
export function lerTemplates(): TemplateEmail[] {
  try {
    const bruto = localStorage.getItem(TEMPLATES_KEY);
    if (!bruto) return [];
    const lista = JSON.parse(bruto) as unknown;
    if (!Array.isArray(lista)) return [];
    return lista.filter(
      (t): t is TemplateEmail =>
        !!t &&
        typeof (t as TemplateEmail).id === "string" &&
        typeof (t as TemplateEmail).nome === "string" &&
        typeof (t as TemplateEmail).corpo === "string"
    );
  } catch {
    return [];
  }
}

/** Id local do template; `randomUUID` com queda para um id de tempo+aleatório. */
export function novoIdTemplate(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
